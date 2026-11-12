import { randomUUID } from 'node:crypto';
import { type AgentService } from '../apps/api/src/chat/agent.service';
import { type ConversationRepository } from '../apps/api/src/chat/conversation.repository';
import { type CartService } from '../apps/api/src/cart/cart.service';
import { collectDishRefs } from '../apps/api/src/tools/tool.format';
import {
  evaluateCase,
  isInfrastructureFailure,
  type DishFacts,
  type Observation,
  type ObservedToolCall,
  type RunFailure,
  type TurnInterruption,
} from './checks';
import { type LlmEventCountingLogger } from './llm-event-counter';
import { discountWait, type RateGate } from './rate-gate';
import { type CaseResult } from './report';
import { type EvalCase } from './schema';
import { parseArgs, type ToolTrace } from './tool-trace';

export const TURN_TIMEOUT_MS = 90_000;
const MARKER = /\[\[dish:([^\]]*)\]\]/g;

/** The slice of Prisma the runner reads and cleans up with. */
export interface EvalDb {
  message: {
    findMany(args: {
      where: { conversationId: string };
      orderBy: Array<{ createdAt: 'asc' } | { id: 'asc' }>;
    }): Promise<Array<{ role: string; content: unknown }>>;
  };
  dish: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; restaurantId: true };
    }): Promise<Array<{ id: string; restaurantId: string }>>;
  };
  conversation: { deleteMany(args: { where: { sessionId: string } }): Promise<unknown> };
  cart: { deleteMany(args: { where: { sessionId: string } }): Promise<unknown> };
}

export interface Services {
  agent: Pick<AgentService, 'run'>;
  conversations: Pick<ConversationRepository, 'resolve'>;
  carts: Pick<CartService, 'getCart'>;
  prisma: EvalDb;
}

export interface RunCaseOptions {
  turnTimeoutMs?: number;
}

/**
 * Runs one case. Whatever happens to the turns (success, `error` event, exception, eval
 * timeout) the counters (calls, retries, timeouts, fallbacks, truncations) are read at the very end and the
 * result is always returned; the tool trace (not the persisted rows) is the source of the tool
 * calls, because a turn cut short is never persisted.
 */
export async function runCase(
  evalCase: EvalCase,
  services: Services,
  catalog: ReadonlyMap<string, DishFacts>,
  gate: RateGate,
  label: string,
  eventLog: LlmEventCountingLogger,
  trace: ToolTrace,
  options: RunCaseOptions = {},
): Promise<CaseResult> {
  const { agent, conversations, carts, prisma } = services;
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const sessionId = randomUUID();
  const runErrors: string[] = [];
  const failure: RunFailure = { errorCodes: [], httpStatuses: [] };
  const cardIdsPerReply: string[][] = [];
  const cartDishIdsPerTurn: string[][] = [];
  const latenciesMs: number[] = [];
  const callsBefore = gate.calls;
  const retriesBefore = eventLog.count;
  const retryWaitBefore = eventLog.waitMs;
  const timeoutsBefore = eventLog.timeouts;
  const fallbacksBefore = eventLog.fallbacks;
  const truncationsBefore = eventLog.truncations;
  let interruption: TurnInterruption | undefined;
  let conversationId: string | undefined;
  let rows: Array<{ role: string; content: unknown }> = [];
  let cartItems: Array<{ dishName: string; quantity: number }> = [];
  let dishRestaurants = new Map<string, string>();
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    try {
      conversationId = await conversations.resolve(sessionId);
      for (const message of evalCase.input) {
        const cards = new Set<string>();
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), turnTimeoutMs);
        let done = false;
        let reason: string | undefined;
        const toolsBefore = trace.size(sessionId);
        const waitedBefore = gate.waitedMs;
        try {
          await agent.run(
            { sessionId, conversationId, message },
            (event) => {
              if (event.type === 'dish_cards') for (const d of event.data.dishes) cards.add(d.id);
              else if (event.type === 'error') {
                failure.errorCodes.push(event.data.code);
                runErrors.push(`${event.data.code}: ${event.data.message}`);
                reason ??= event.data.code;
              } else if (event.type === 'done') {
                done = true;
                inputTokens += event.data.usage.inputTokens;
                outputTokens += event.data.usage.outputTokens;
                // The gate's pacing sleeps happen inside the turn: not agent latency.
                latenciesMs.push(discountWait(event.data.latencyMs, gate.waitedMs - waitedBefore));
              }
            },
            abort.signal,
          );
        } catch (error) {
          const status = (error as { status?: unknown } | null)?.status;
          if (typeof status === 'number') failure.httpStatuses.push(status);
          runErrors.push(error instanceof Error ? error.message : String(error));
          reason ??= 'EXCEPTION';
        } finally {
          clearTimeout(timer);
        }
        if (!done && runErrors.length === 0) {
          runErrors.push('turn did not finish (timeout)');
          reason = abort.signal.aborted ? 'EVAL_TIMEOUT' : 'NO_DONE';
        }
        if (!done) {
          interruption = {
            reason: reason ?? 'UNKNOWN',
            toolsRun: trace
              .calls(sessionId)
              .slice(toolsBefore)
              .map((call) => call.name),
          };
        }
        cardIdsPerReply.push([...cards]);
        const turnCart = await carts.getCart(sessionId);
        cartDishIdsPerTurn.push(turnCart.items.map((item) => item.dishId));
        if (runErrors.length > 0) break;
      }
    } catch (error) {
      runErrors.push(error instanceof Error ? error.message : String(error));
    }

    // Reading the outcome back may itself fail; it must not lose the counters.
    try {
      if (conversationId !== undefined) {
        rows = await prisma.message.findMany({
          where: { conversationId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
      }
      cartItems = (await carts.getCart(sessionId)).items.map((item) => ({
        dishName: item.name,
        quantity: item.quantity,
      }));
      dishRestaurants = new Map(
        (
          await prisma.dish.findMany({
            where: { id: { in: [...new Set(cartDishIdsPerTurn.flat())] } },
            select: { id: true, restaurantId: true },
          })
        ).map((d) => [d.id, d.restaurantId]),
      );
    } catch (error) {
      runErrors.push(
        `could not read the outcome: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const persistedCalls: ObservedToolCall[] = [];
    const seen = new Map<string, string>();
    const cited: string[] = [];
    let lastTurnTexts: string[] = [];
    for (const row of rows) {
      const content = row.content as Record<string, unknown>;
      if (row.role === 'USER') lastTurnTexts = [];
      if (row.role === 'ASSISTANT') {
        const calls = Array.isArray(content.toolCalls) ? content.toolCalls : [];
        for (const call of calls as Array<{ name: string; argsJson: string }>) {
          persistedCalls.push({ name: call.name, args: parseArgs(call.argsJson) });
        }
        const text = typeof content.text === 'string' ? content.text : '';
        if (text) lastTurnTexts.push(text);
        for (const match of text.matchAll(MARKER)) cited.push(match[1] ?? '');
      } else if (row.role === 'TOOL') {
        collectDishRefs(content.result, seen);
      }
    }

    // Source of truth: the trace of executions. Persisted rows are only a cross-check, and
    // only when every turn finished (an interrupted turn leaves no rows).
    const toolCalls = trace.calls(sessionId);
    if (!interruption && runErrors.length === 0) {
      const traced = JSON.stringify(toolCalls);
      if (traced !== JSON.stringify(persistedCalls)) {
        console.warn(
          `\n  AVISO (${label}): rastro de tools diverge das mensagens persistidas ` +
            `(rastro ${toolCalls.length}, banco ${persistedCalls.length})`,
        );
      }
    }

    const observation: Observation = {
      toolCalls,
      cardIdsPerReply,
      dishes: catalog,
      cartItems,
      cartRestaurantIdsPerTurn: cartDishIdsPerTurn.map((ids) =>
        ids.map((id) => dishRestaurants.get(id) ?? `unknown:${id}`),
      ),
      finalReplyText: lastTurnTexts.join('\n'),
      hallucinatedIds: [...new Set(cited.filter((id) => !seen.has(id)))],
      runErrors,
      ...(interruption ? { interruption } : {}),
    };
    const outcome = evaluateCase(evalCase, observation);
    // Taken last, after every outcome above: valid for any way the turns ended.
    const callsAfter = gate.calls;
    return {
      id: label,
      category: evalCase.category,
      passed: outcome.passed,
      infra: isInfrastructureFailure(failure),
      checks: outcome.checks,
      inputTokens,
      outputTokens,
      latenciesMs,
      chatCalls: callsAfter.chat - callsBefore.chat,
      embedCalls: callsAfter.embed - callsBefore.embed,
      retries: eventLog.count - retriesBefore,
      retryWaitMs: eventLog.waitMs - retryWaitBefore,
      timeouts: eventLog.timeouts - timeoutsBefore,
      fallbacks: eventLog.fallbacks - fallbacksBefore,
      truncations: eventLog.truncations - truncationsBefore,
      finalReplyText: observation.finalReplyText,
    };
  } finally {
    await prisma.conversation.deleteMany({ where: { sessionId } });
    await prisma.cart.deleteMany({ where: { sessionId } });
  }
}

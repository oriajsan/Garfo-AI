import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ChatEvent } from '@garfo/shared';
import { CartService } from '../cart/cart.service';
import { SearchService } from '../catalog/search.service';
import { describeProviderError } from '../llm/http-diagnostics';
import { LlmOverloadedError, LlmTimeoutError, LlmTruncatedError } from '../llm/llm.errors';
import { LLM_PROVIDER } from '../llm/llm.tokens';
import { type ChatMessage, type LlmProvider, type ToolCall } from '../llm/llm.types';
import { buildSystemPrompt, summarizeCart } from '../prompts/system-prompt';
import { ToolRegistry } from '../tools/tool.registry';
import { ConversationRepository, type MessageRecord } from './conversation.repository';
import { DishMarkerParser } from './dish-marker.parser';
import { isCompleteFinish, truncationReason } from './truncation';

export const MAX_ITERATIONS = 6;
export const MAX_OUTPUT_TOKENS = 800;
export const ITERATION_LIMIT_TEXT =
  'Desculpe, não consegui concluir esse pedido. Pode reformular de um jeito mais simples?';
export const EMPTY_ANSWER_TEXT = 'Desculpe, não consegui responder agora. Pode tentar de novo?';
export const LLM_ERROR_TEXT =
  'Não consegui falar com o assistente agora. Tente novamente em instantes.';
export const LLM_OVERLOADED_TEXT =
  'O serviço de IA está sobrecarregado no momento. Tente novamente em alguns instantes.';
export const LLM_TIMEOUT_TEXT = 'O serviço de IA demorou demais para responder. Tente novamente.';
export const PERSIST_ERROR_TEXT = 'Não consegui salvar a conversa. Tente novamente em instantes.';

export interface AgentInput {
  sessionId: string;
  /** Already resolved (existing or newly created) by the controller. */
  conversationId: string;
  message: string;
}

export type EmitEvent = (event: ChatEvent) => void;

interface AttemptContext {
  system: string;
  messages: ChatMessage[];
  definitions: ReturnType<ToolRegistry['definitions']>;
  signal: AbortSignal;
  emit: EmitEvent;
  /** Token usage of every attempt adds up, truncated ones included (they were paid for). */
  usage: { inputTokens: number; outputTokens: number };
  conversationId: string;
}

/** One model call of the loop, already flushed but with nothing held back emitted yet. */
interface Attempt {
  rawText: string;
  toolCalls: ToolCall[];
  parser: DishMarkerParser;
  /** What the parser held back until the end; emitted only if the attempt is accepted. */
  tail: string;
  unclosedMarkerAtEnd: boolean;
  finishReason: string | null;
}

/**
 * The agent loop (SPEC section 6): model call, streamed text, tool calls, repeat, persist.
 * No framework: a bounded `for` loop over `LlmProvider.chat`.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tools: ToolRegistry,
    private readonly conversations: ConversationRepository,
    private readonly carts: CartService,
    private readonly search: SearchService,
  ) {}

  async run(input: AgentInput, emitEvent: EmitEvent, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    // After an abort nothing else may be emitted (the client is gone).
    const emit: EmitEvent = (event) => {
      if (!signal.aborted) emitEvent(event);
    };
    const { conversationId, sessionId } = input;
    emit({ type: 'meta', data: { conversationId } });

    const records: MessageRecord[] = [{ role: 'USER', content: { text: input.message } }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const toolsCalled: string[] = [];
    const discarded: string[] = [];
    let iterations = 0;

    try {
      const [history, seen, cart] = await Promise.all([
        this.conversations.loadHistory(conversationId),
        this.conversations.loadSeenDishes(conversationId),
        this.carts.getCart(sessionId),
      ]);
      // Dishes any tool has returned in this conversation: the only ids that may become cards.
      const knownDishes = new Map(seen);
      const system = buildSystemPrompt({ now: new Date(), cartSummary: summarizeCart(cart) });
      const messages: ChatMessage[] = [...history, { role: 'user', content: input.message }];
      const definitions = this.tools.definitions();
      let answered = false;
      const ctx: AttemptContext = {
        system,
        messages,
        definitions,
        signal,
        emit,
        usage,
        conversationId,
      };

      while (iterations < MAX_ITERATIONS && !answered) {
        iterations += 1;
        if (signal.aborted) return;

        let attempt = await this.streamAttempt(ctx, 1);
        if (!attempt) return;
        let reason = this.truncation(attempt);
        if (reason) {
          this.logTruncated(conversationId, attempt, reason, 1);
          // Part of the cut text may already be on screen; the client wipes it.
          emit({ type: 'message_reset', data: { reason: 'truncated' } });
          // One more try through the same provider path (its own retries, timeout, fallback).
          // It does not count against MAX_ITERATIONS.
          attempt = await this.streamAttempt(ctx, 2);
          if (!attempt) return;
          reason = this.truncation(attempt);
          if (reason) {
            this.logTruncated(conversationId, attempt, reason, 2);
            emit({ type: 'message_reset', data: { reason: 'truncated' } });
            throw new LlmTruncatedError(reason);
          }
        }
        // Only the accepted attempt reaches this point: cards, ids and the persisted text.
        const { parser, toolCalls, tail } = attempt;
        let { rawText } = attempt;
        if (tail) emit({ type: 'token', data: { text: tail } });

        const cited = parser.ids;
        const validIds = cited.filter((id) => knownDishes.has(id));
        const unknownIds = cited.filter((id) => !knownDishes.has(id));
        discarded.push(...unknownIds);
        if (unknownIds.length > 0 || parser.malformed > 0) {
          this.logger.warn(
            JSON.stringify({
              event: 'possible_hallucination',
              conversationId,
              discardedDishIds: unknownIds,
              malformedMarkers: parser.malformed,
            }),
          );
        }
        if (validIds.length > 0) {
          const dishes = await this.search.getDishCards(validIds);
          if (dishes.length > 0) emit({ type: 'dish_cards', data: { dishes } });
        }

        const hasTools = toolCalls.length > 0;
        if (!hasTools && rawText.trim() === '') {
          emit({ type: 'token', data: { text: EMPTY_ANSWER_TEXT } });
          rawText = EMPTY_ANSWER_TEXT;
        }
        records.push({
          role: 'ASSISTANT',
          content: {
            text: rawText,
            ...(hasTools ? { toolCalls } : {}),
            ...(validIds.length > 0 ? { dishIds: validIds } : {}),
          },
        });
        if (!hasTools) {
          answered = true;
          break;
        }

        // The assistant message that owns the calls must come before every tool message.
        messages.push({ role: 'assistant', content: rawText, toolCalls });
        for (const call of toolCalls) {
          if (signal.aborted) return;
          toolsCalled.push(call.name);
          emit({
            type: 'tool_start',
            data: {
              id: call.id,
              name: call.name,
              label: this.tools.label(call.name, call.argsJson, knownDishes),
            },
          });
          const execution = await this.tools.execute(call.name, call.argsJson, { sessionId });
          emit({ type: 'tool_end', data: { id: call.id, name: call.name, ok: execution.ok } });

          for (const [id, name] of execution.dishes) knownDishes.set(id, name);
          if (execution.cart) emit({ type: 'cart_updated', data: { cart: execution.cart } });

          records.push({
            role: 'TOOL',
            content: { toolCallId: call.id, name: call.name, result: execution.result },
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(execution.result),
          });
        }
      }

      if (!answered) {
        emit({ type: 'token', data: { text: ITERATION_LIMIT_TEXT } });
        records.push({ role: 'ASSISTANT', content: { text: ITERATION_LIMIT_TEXT } });
      }
    } catch (error) {
      if (signal.aborted) return;
      this.logger.error(
        JSON.stringify({
          event: 'chat_error',
          conversationId,
          message: error instanceof Error ? error.message : 'unknown',
          ...describeProviderError(error instanceof LlmOverloadedError ? error.cause : error),
        }),
      );
      if (error instanceof LlmOverloadedError) {
        emit({ type: 'error', data: { code: 'LLM_OVERLOADED', message: LLM_OVERLOADED_TEXT } });
      } else if (error instanceof LlmTimeoutError) {
        emit({ type: 'error', data: { code: 'LLM_TIMEOUT', message: LLM_TIMEOUT_TEXT } });
      } else {
        emit({ type: 'error', data: { code: 'LLM_ERROR', message: LLM_ERROR_TEXT } });
      }
      return;
    }

    if (signal.aborted) return;
    try {
      await this.conversations.saveRound(conversationId, records);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'chat_persist_error',
          conversationId,
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
      emit({ type: 'error', data: { code: 'INTERNAL_ERROR', message: PERSIST_ERROR_TEXT } });
      return;
    }

    const latencyMs = Date.now() - startedAt;
    this.logger.log(
      JSON.stringify({
        event: 'chat_message',
        conversationId,
        tools: toolsCalled,
        iterations,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        discardedDishIds: discarded,
      }),
    );
    emit({ type: 'done', data: { usage, latencyMs } });
  }

  /**
   * Streams one model call, forwarding text as `token` events as it arrives. Returns undefined
   * when the user aborted. The parser is always flushed at the normal end of the stream; if the
   * stream throws, the whole turn fails and nothing is persisted, so there is nothing to flush.
   */
  private async streamAttempt(ctx: AttemptContext, attempt: number): Promise<Attempt | undefined> {
    const { signal, emit, usage } = ctx;
    const parser = new DishMarkerParser();
    let rawText = '';
    const toolCalls: ToolCall[] = [];
    let finishReason: string | null = null;
    let model = 'unknown';

    const stream = this.llm.chat({
      system: ctx.system,
      messages: ctx.messages,
      tools: ctx.definitions,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });
    for await (const chunk of stream) {
      if (signal.aborted) return undefined;
      if (chunk.type === 'text') {
        rawText += chunk.delta;
        const safe = parser.push(chunk.delta);
        if (safe) emit({ type: 'token', data: { text: safe } });
      } else if (chunk.type === 'tool_call') {
        toolCalls.push({
          id: chunk.id,
          name: chunk.name,
          argsJson: chunk.argsJson,
          ...(chunk.extraContent !== undefined ? { extraContent: chunk.extraContent } : {}),
        });
      } else {
        usage.inputTokens += chunk.usage.inputTokens;
        usage.outputTokens += chunk.usage.outputTokens;
        finishReason = chunk.finishReason;
        model = chunk.model;
      }
    }
    if (signal.aborted) return undefined;
    const malformedBefore = parser.malformed;
    const tail = parser.flush();

    this.logger.log(
      JSON.stringify({
        event: 'llm_stream_end',
        conversationId: ctx.conversationId,
        attempt,
        model,
        finishReason,
        completed: isCompleteFinish(finishReason),
        textLength: rawText.length,
        toolCalls: toolCalls.length,
      }),
    );
    return {
      rawText,
      toolCalls,
      parser,
      tail,
      unclosedMarkerAtEnd: parser.malformed > malformedBefore,
      finishReason,
    };
  }

  private truncation(attempt: Attempt): string | null {
    return truncationReason({
      finishReason: attempt.finishReason,
      toolCallCount: attempt.toolCalls.length,
      rawText: attempt.rawText,
      unclosedMarkerAtEnd: attempt.unclosedMarkerAtEnd,
    });
  }

  private logTruncated(
    conversationId: string,
    attempt: Attempt,
    reason: string,
    attemptNumber: number,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'llm_truncated',
        conversationId,
        attempt: attemptNumber,
        reason,
        finishReason: attempt.finishReason,
        textLength: attempt.rawText.length,
        toolCalls: attempt.toolCalls.length,
        willRetry: attemptNumber === 1,
      }),
    );
  }
}

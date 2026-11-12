import type { CartService } from '../apps/api/src/cart/cart.service';
import type { SearchService } from '../apps/api/src/catalog/search.service';
import { ToolRegistry, type ToolExecution } from '../apps/api/src/tools/tool.registry';
import { type ToolContext } from '../apps/api/src/tools/tool.types';
import { type ObservedToolCall } from './checks';

/**
 * Tool executions seen per session, in order. The agent only persists a turn at its very end
 * (`saveRound`), so a turn cut short leaves no rows; this trace survives it.
 */
export class ToolTrace {
  private readonly bySession = new Map<string, ObservedToolCall[]>();

  record(sessionId: string, call: ObservedToolCall): void {
    const calls = this.bySession.get(sessionId) ?? [];
    calls.push(call);
    this.bySession.set(sessionId, calls);
  }

  /** Calls of the session, in execution order. */
  calls(sessionId: string): ObservedToolCall[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  size(sessionId: string): number {
    return this.bySession.get(sessionId)?.length ?? 0;
  }
}

export function parseArgs(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson.trim() === '' ? '{}' : argsJson) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The production registry plus a recorder: eval only (installed with `overrideProvider`), the
 * production code is untouched. A call is recorded when it STARTS, so a tool still running when
 * the turn dies is in the trace too. Args are the parsed `argsJson` exactly as the model sent
 * them (`undefined` for invalid JSON), the same shape the persisted rows give.
 */
export class TracingToolRegistry extends ToolRegistry {
  constructor(
    search: SearchService,
    cart: CartService,
    private readonly trace: ToolTrace,
  ) {
    super(search, cart);
  }

  override execute(name: string, argsJson: string, ctx: ToolContext): Promise<ToolExecution> {
    this.trace.record(ctx.sessionId, { name, args: parseArgs(argsJson) });
    return super.execute(name, argsJson, ctx);
  }
}

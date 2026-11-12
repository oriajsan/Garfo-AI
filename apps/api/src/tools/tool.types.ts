import { type Cart } from '@garfo/shared';
import { type z } from 'zod';

/** What every handler receives besides its validated arguments. */
export interface ToolContext {
  sessionId: string;
}

/** Names of the dishes seen so far (id -> name), so labels can say "2× Baião de dois". */
export type DishNames = ReadonlyMap<string, string>;

export interface ToolOutput {
  /** JSON-serialisable payload handed back to the model. */
  result: unknown;
  /** Set by the tools that change the cart; the agent turns it into `cart_updated`. */
  cart?: Cart;
}

/** One agent tool: name, pt-BR description, input schema, handler and progress label. */
export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** In Portuguese, written for the model: when to use the tool and when not to. */
  description: string;
  schema: S;
  handler(args: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
  /** pt-BR text for the `tool_start` event, built from the arguments. */
  label(args: z.output<S>, names: DishNames): string;
}

/** Keeps the argument type of each tool while letting the registry hold them in one list. */
export function defineTool<S extends z.ZodTypeAny>(tool: AgentTool<S>): AgentTool {
  return tool;
}

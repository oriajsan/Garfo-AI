import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Cart, type ErrorCode } from '@garfo/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CartService } from '../cart/cart.service';
import { SearchService } from '../catalog/search.service';
import { DomainError } from '../common/domain-error';
import { describeZodError } from '../common/filters/all-exceptions.filter';
import { type ToolDefinition } from '../llm/llm.types';
import { createAddToCartTool } from './add-to-cart.tool';
import { createClearCartTool } from './clear-cart.tool';
import { createGetDishTool } from './get-dish.tool';
import { createGetRestaurantTool } from './get-restaurant.tool';
import { createSearchDishesTool } from './search-dishes.tool';
import { collectDishRefs } from './tool.format';
import { type AgentTool, type DishNames, type ToolContext } from './tool.types';
import { createUpdateCartItemTool } from './update-cart-item.tool';
import { createViewCartTool } from './view-cart.tool';

export const TOOL_TIMEOUT_MS = 10_000;
export const TOOL_OPTIONS = Symbol('TOOL_OPTIONS');
export interface ToolOptions {
  timeoutMs?: number;
}

export interface ToolErrorResult {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

/** Outcome of one tool call. It never throws: failures are results the model can explain. */
export interface ToolExecution {
  ok: boolean;
  /** Exactly what is sent back to the model and persisted. */
  result: unknown;
  /** Dishes (id -> name) present in the result: the ids the model may cite afterwards. */
  dishes: Map<string, string>;
  /** Set when the call changed the cart (becomes `cart_updated`). */
  cart?: Cart;
}

/** The 7 tools of the agent (SPEC section 6): definitions, validation, timeout, error mapping. */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools: ReadonlyMap<string, AgentTool>;
  private readonly timeoutMs: number;

  constructor(
    search: SearchService,
    cart: CartService,
    @Optional() @Inject(TOOL_OPTIONS) options?: ToolOptions,
  ) {
    this.timeoutMs = options?.timeoutMs ?? TOOL_TIMEOUT_MS;
    const list: AgentTool[] = [
      createSearchDishesTool(search),
      createGetRestaurantTool(search),
      createGetDishTool(search),
      createViewCartTool(cart),
      createAddToCartTool(cart),
      createUpdateCartItemTool(cart),
      createClearCartTool(cart),
    ];
    this.tools = new Map(list.map((tool) => [tool.name, tool]));
  }

  /** JSON Schema definitions in the shape the providers expect (no `$schema`, no `$ref`). */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => {
      const schema = zodToJsonSchema(tool.schema as never, {
        target: 'openApi3',
        $refStrategy: 'none',
      });
      const { $schema: _ignored, ...parameters } = schema as Record<string, unknown>;
      return { name: tool.name, description: tool.description, parameters };
    });
  }

  /** Progress text for `tool_start`; falls back to a generic label for bad arguments. */
  label(name: string, argsJson: string, names: DishNames): string {
    const tool = this.tools.get(name);
    const parsed = tool ? this.parse(tool, argsJson) : undefined;
    if (!tool || !parsed?.ok) return 'Processando o pedido…';
    return tool.label(parsed.args, names);
  }

  async execute(name: string, argsJson: string, ctx: ToolContext): Promise<ToolExecution> {
    const tool = this.tools.get(name);
    if (!tool) return failure('VALIDATION_ERROR', `Ferramenta desconhecida: ${name}.`);

    const parsed = this.parse(tool, argsJson);
    if (!parsed.ok) return failure('VALIDATION_ERROR', parsed.message);

    try {
      const output = await this.withTimeout(tool.handler(parsed.args, ctx));
      if (output === TIMED_OUT) {
        return failure('TOOL_TIMEOUT', 'A consulta demorou demais. Tente novamente.');
      }
      return {
        ok: true,
        result: output.result,
        dishes: collectDishRefs(output.result),
        ...(output.cart ? { cart: output.cart } : {}),
      };
    } catch (error) {
      if (error instanceof DomainError) {
        return failure(error.code, error.message, error.details);
      }
      this.logger.error(
        `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return failure('INTERNAL_ERROR', 'Não foi possível executar a ação agora.');
    }
  }

  private parse(
    tool: AgentTool,
    argsJson: string,
  ): { ok: true; args: unknown } | { ok: false; message: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(argsJson.trim() === '' ? '{}' : argsJson);
    } catch {
      return { ok: false, message: 'Argumentos não são um JSON válido.' };
    }
    const result = tool.schema.safeParse(raw);
    if (!result.success) return { ok: false, message: describeZodError(result.error) };
    return { ok: true, args: result.data as unknown };
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

const TIMED_OUT = Symbol('TIMED_OUT');

function failure(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolExecution {
  const result: ToolErrorResult = {
    error: { code, message, ...(details ? { details } : {}) },
  };
  return { ok: false, result, dishes: new Map() };
}

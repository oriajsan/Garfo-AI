import {
  apiErrorSchema,
  cartSchema,
  chatMessagesResponseSchema,
  checkoutSchema,
  healthResponseSchema,
  type AddCartItemBody,
  type Cart,
  type ChatMessagesResponse,
  type Checkout,
  type ErrorCode,
  type HealthResponse,
} from '@garfo/shared';
import { API_URL } from './env';
import { getSessionId } from './session';

/** Error from the API (`{ error: { code, message } }`) or from the network (`code: null`). */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | null,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const NETWORK_ERROR_MESSAGE = 'Não consegui falar com o servidor. Verifique sua conexão.';

/** Turns a failed response into an ApiRequestError, whatever the body looks like. */
export async function toApiError(response: Response): Promise<ApiRequestError> {
  try {
    const body: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiRequestError(code, message, response.status, details);
    }
  } catch {
    // Not JSON (proxy error page, for example).
  }
  return new ApiRequestError(null, `Erro inesperado (HTTP ${response.status}).`, response.status);
}

export function sessionHeaders(): Record<string, string> {
  return { 'X-Session-Id': getSessionId() };
}

async function request<T>(
  schema: { parse: (data: unknown) => T },
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...sessionHeaders(),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(null, NETWORK_ERROR_MESSAGE, 0);
  }
  if (!response.ok) throw await toApiError(response);
  const data: unknown = await response.json();
  return schema.parse(data);
}

export const api = {
  health: (): Promise<HealthResponse> => request(healthResponseSchema, '/health'),
  getCart: (): Promise<Cart> => request(cartSchema, '/cart'),
  addCartItem: (body: AddCartItemBody): Promise<Cart> =>
    request(cartSchema, '/cart/items', { method: 'POST', body }),
  updateCartItem: (itemId: string, quantity: number): Promise<Cart> =>
    request(cartSchema, `/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: { quantity },
    }),
  clearCart: (): Promise<Cart> => request(cartSchema, '/cart', { method: 'DELETE' }),
  checkout: (): Promise<Checkout> => request(checkoutSchema, '/cart/checkout', { method: 'POST' }),
  getMessages: (conversationId: string): Promise<ChatMessagesResponse> =>
    request(chatMessagesResponseSchema, `/chat/${encodeURIComponent(conversationId)}/messages`),
};

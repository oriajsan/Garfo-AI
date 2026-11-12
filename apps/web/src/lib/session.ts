const SESSION_KEY = 'garfo.sessionId';
const CONVERSATION_KEY = 'garfo.conversationId';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private mode); the app still works for the current page view.
  }
}

let memorySessionId: string | null = null;

function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // crypto.randomUUID needs a secure context; plain-http LAN access (phone tests) lacks it.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Anonymous session id (SPEC section 4): generated once and kept in localStorage. */
export function getSessionId(): string {
  if (memorySessionId) return memorySessionId;
  const stored = read(SESSION_KEY);
  const id = stored ?? newUuid();
  if (!stored) write(SESSION_KEY, id);
  memorySessionId = id;
  return id;
}

export function getStoredConversationId(): string | null {
  return read(CONVERSATION_KEY);
}

export function storeConversationId(id: string | null): void {
  write(CONVERSATION_KEY, id);
}

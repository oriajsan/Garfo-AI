import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { type ChatMessage, type JsonValue, type ToolCall } from '../llm/llm.types';
import { collectDishRefs } from '../tools/tool.format';

export const HISTORY_LIMIT = 20;

/** What goes into `Message.content` (D3.6). Assistant text is stored raw, with markers. */
export type MessageRecord =
  | { role: 'USER'; content: { text: string } }
  | {
      role: 'ASSISTANT';
      content: { text: string; toolCalls?: ToolCall[]; dishIds?: string[] };
    }
  | { role: 'TOOL'; content: { toolCallId: string; name: string; result: unknown } };

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);

const userContent = z.object({ text: z.string() });
const assistantContent = z.object({
  text: z.string(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        argsJson: z.string(),
        extraContent: jsonValue.optional(),
      }),
    )
    .optional(),
  dishIds: z.array(z.string()).optional(),
});
const toolContent = z.object({ toolCallId: z.string(), name: z.string(), result: z.unknown() });

export interface VisibleRow {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  dishIds: string[];
  createdAt: Date;
}

export interface StoredMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: unknown;
  createdAt: Date;
}

/**
 * Turns stored rows into provider messages, guaranteeing what OpenAI demands: the history
 * starts at a USER message (D3.1) and every `tool` message follows the assistant message that
 * owns its `tool_call_id`. Incomplete groups are dropped instead of sent.
 */
export function toHistory(rows: StoredMessage[]): ChatMessage[] {
  const firstUser = rows.findIndex((row) => row.role === 'USER');
  if (firstUser === -1) return [];

  const messages: ChatMessage[] = [];
  const window = rows.slice(firstUser);
  for (let i = 0; i < window.length; i += 1) {
    const row = window[i];
    if (!row) continue;
    if (row.role === 'USER') {
      const parsed = userContent.safeParse(row.content);
      if (parsed.success) messages.push({ role: 'user', content: parsed.data.text });
    } else if (row.role === 'ASSISTANT') {
      const parsed = assistantContent.safeParse(row.content);
      if (!parsed.success) continue;
      const { text, toolCalls } = parsed.data;
      if (!toolCalls?.length) {
        messages.push({ role: 'assistant', content: text });
        continue;
      }
      // Gather the tool results that answer this assistant message, in order.
      const results: ChatMessage[] = [];
      let next = i + 1;
      for (; next < window.length && window[next]?.role === 'TOOL'; next += 1) {
        const tool = toolContent.safeParse(window[next]?.content);
        if (tool.success) {
          results.push({
            role: 'tool',
            toolCallId: tool.data.toolCallId,
            name: tool.data.name,
            content: JSON.stringify(tool.data.result),
          });
        }
      }
      const answered = new Set(results.map((r) => (r.role === 'tool' ? r.toolCallId : '')));
      if (toolCalls.every((call) => answered.has(call.id))) {
        messages.push({ role: 'assistant', content: text, toolCalls }, ...results);
      }
      i = next - 1;
    }
    // A TOOL row reaching this point has no owning assistant message: dropped.
  }
  return messages;
}

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Existing conversation of this session, or a new one (D3.5). Returns its id. */
  async resolve(sessionId: string, conversationId?: string): Promise<string> {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, sessionId },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
    const created = await this.prisma.conversation.create({
      data: { sessionId },
      select: { id: true },
    });
    return created.id;
  }

  async exists(sessionId: string, conversationId: string): Promise<boolean> {
    const found = await this.prisma.conversation.findFirst({
      where: { id: conversationId, sessionId },
      select: { id: true },
    });
    return found !== null;
  }

  /** Last 20 messages, cut so that they start at a USER message and never hold an orphan TOOL. */
  async loadHistory(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return toHistory(rows.reverse());
  }

  /** Dishes (id -> name) returned by any tool in the whole conversation (D3.2). */
  async loadSeenDishes(conversationId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, role: 'TOOL' },
      select: { content: true },
    });
    const seen = new Map<string, string>();
    for (const row of rows) {
      const parsed = toolContent.safeParse(row.content);
      if (parsed.success) collectDishRefs(parsed.data.result, seen);
    }
    return seen;
  }

  /** Persists the whole round in one transaction, with strictly increasing timestamps. */
  async saveRound(conversationId: string, records: MessageRecord[]): Promise<void> {
    const base = Date.now();
    await this.prisma.$transaction(
      records.map((record, index) =>
        this.prisma.message.create({
          data: {
            conversationId,
            role: record.role,
            content: record.content as Prisma.InputJsonValue,
            createdAt: new Date(base + index),
          },
        }),
      ),
    );
  }

  /** USER and ASSISTANT rows, oldest first, for `GET /chat/:id/messages`. */
  async listVisible(conversationId: string): Promise<VisibleRow[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row): VisibleRow[] => {
      if (row.role === 'USER') {
        const parsed = userContent.safeParse(row.content);
        return parsed.success
          ? [
              {
                id: row.id,
                role: 'user' as const,
                text: parsed.data.text,
                dishIds: [],
                createdAt: row.createdAt,
              },
            ]
          : [];
      }
      const parsed = assistantContent.safeParse(row.content);
      if (!parsed.success) return [];
      return [
        {
          id: row.id,
          role: 'assistant' as const,
          text: parsed.data.text,
          dishIds: parsed.data.dishIds ?? [],
          createdAt: row.createdAt,
        },
      ];
    });
  }

  async countUserMessagesSince(since: Date): Promise<number> {
    return this.prisma.message.count({ where: { role: 'USER', createdAt: { gte: since } } });
  }
}

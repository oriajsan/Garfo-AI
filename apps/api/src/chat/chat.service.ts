import { Injectable } from '@nestjs/common';
import { type ChatMessagesResponse, type DishCard } from '@garfo/shared';
import { DomainError } from '../common/domain-error';
import { startOfDaySaoPaulo } from '../common/time';
import { ConfigService } from '../config/config.service';
import { SearchService } from '../catalog/search.service';
import { ConversationRepository } from './conversation.repository';
import { DishMarkerParser } from './dish-marker.parser';

export const BUDGET_EXCEEDED_MESSAGE =
  'A demo atingiu o limite de conversas de hoje. Volte amanhã!';

@Injectable()
export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly search: SearchService,
    private readonly config: ConfigService,
  ) {}

  /** Daily ceiling, counted in the database: USER messages since midnight in São Paulo (D3.8). */
  async assertWithinDailyBudget(now: Date = new Date()): Promise<void> {
    const used = await this.conversations.countUserMessagesSince(startOfDaySaoPaulo(now));
    if (used >= this.config.get('MAX_DAILY_CHAT_REQUESTS')) {
      throw new DomainError('BUDGET_EXCEEDED', BUDGET_EXCEEDED_MESSAGE);
    }
  }

  resolveConversation(sessionId: string, conversationId?: string): Promise<string> {
    return this.conversations.resolve(sessionId, conversationId);
  }

  /** Visible messages (no tool rows, no markers) with the cards rebuilt from `dishIds`. */
  async getMessages(sessionId: string, conversationId: string): Promise<ChatMessagesResponse> {
    if (!(await this.conversations.exists(sessionId, conversationId))) {
      throw new DomainError('CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
    }
    const rows = await this.conversations.listVisible(conversationId);
    const allIds = [...new Set(rows.flatMap((row) => row.dishIds))];
    const cards = new Map<string, DishCard>(
      (await this.search.getDishCards(allIds)).map((card) => [card.id, card]),
    );

    const messages = rows.flatMap((row) => {
      const text = stripMarkers(row.text);
      if (text.trim() === '') return [];
      return [
        {
          id: row.id,
          role: row.role,
          text,
          dishCards: row.dishIds.flatMap((id) => {
            const card = cards.get(id);
            return card ? [card] : [];
          }),
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
    return { conversationId, messages };
  }
}

function stripMarkers(text: string): string {
  const parser = new DishMarkerParser();
  return parser.push(text) + parser.flush();
}

import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { type ChatMessagesResponse } from '@garfo/shared';
import { type Response } from 'express';
import { SessionGuard, SessionId } from '../common/session.guard';
import { AgentService } from './agent.service';
import { ChatMessagesResponseDto, ChatRequestDto } from './chat.dto';
import { ChatService } from './chat.service';
import { ChatThrottlerGuard } from './chat.throttler';
import { SseStream } from './sse';

@ApiTags('chat')
@ApiHeader({ name: 'X-Session-Id', required: true, description: 'UUID da sessão anônima' })
@UseGuards(SessionGuard)
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    private readonly agent: AgentService,
  ) {}

  @Post()
  @UseGuards(ChatThrottlerGuard)
  @ApiOperation({
    summary: 'Envia uma mensagem ao agente e recebe a resposta em streaming (SSE)',
    description:
      'Eventos: meta, token, tool_start, tool_end, dish_cards, cart_updated, done, error. ' +
      'Erros de validação, limite de requisições e teto diário respondem JSON (400/429) antes do stream.',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/event-stream')
  async send(
    @SessionId() sessionId: string,
    @Body() body: ChatRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    // Everything that can fail with a normal HTTP error happens before the stream opens (D3.7).
    await this.chat.assertWithinDailyBudget();
    const conversationId = await this.chat.resolveConversation(sessionId, body.conversationId);

    const stream = new SseStream(res);
    const abort = new AbortController();
    // `close` fires when the connection ends; if the response was not finished, the client left.
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    stream.open();
    try {
      await this.agent.run(
        { sessionId, conversationId, message: body.message },
        (event) => stream.send(event),
        abort.signal,
      );
    } catch (error) {
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      stream.send({
        type: 'error',
        data: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.' },
      });
    } finally {
      stream.close();
    }
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: 'Mensagens visíveis (usuário e assistente) para reidratar o chat' })
  @ApiOkResponse({ type: ChatMessagesResponseDto })
  messages(
    @SessionId() sessionId: string,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<ChatMessagesResponse> {
    return this.chat.getMessages(sessionId, conversationId);
  }
}

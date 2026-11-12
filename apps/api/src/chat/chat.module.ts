import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { LlmModule } from '../llm/llm.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentService } from './agent.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatThrottlerGuard, chatThrottlerOptions } from './chat.throttler';
import { ConversationRepository } from './conversation.repository';

@Module({
  imports: [
    ThrottlerModule.forRoot(chatThrottlerOptions),
    LlmModule,
    CatalogModule,
    CartModule,
    ToolsModule,
  ],
  controllers: [ChatController],
  providers: [AgentService, ChatService, ConversationRepository, ChatThrottlerGuard],
})
export class ChatModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { createEmbeddingProvider, createLlmProvider } from './llm.factory';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from './llm.tokens';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createLlmProvider(config.all()),
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createEmbeddingProvider(config.all()),
    },
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER],
})
export class LlmModule {}

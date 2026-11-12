import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { CatalogController } from './catalog.controller';
import { SearchService } from './search.service';

@Module({
  imports: [LlmModule],
  controllers: [CatalogController],
  providers: [SearchService],
  exports: [SearchService],
})
export class CatalogModule {}

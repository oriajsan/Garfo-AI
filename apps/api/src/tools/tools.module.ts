import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ToolRegistry } from './tool.registry';

@Module({
  imports: [CatalogModule, CartModule],
  providers: [ToolRegistry],
  exports: [ToolRegistry],
})
export class ToolsModule {}

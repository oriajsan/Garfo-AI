import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Cart, type Checkout } from '@garfo/shared';
import { SessionGuard, SessionId } from '../common/session.guard';
import { AddCartItemDto, CartDto, CheckoutDto, UpdateCartItemDto } from './cart.dto';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiHeader({ name: 'X-Session-Id', required: true, description: 'UUID da sessão anônima' })
@UseGuards(SessionGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Carrinho aberto da sessão (vazio se não houver)' })
  @ApiOkResponse({ type: CartDto })
  get(@SessionId() sessionId: string): Promise<Cart> {
    return this.cart.getCart(sessionId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Adiciona um prato (soma se já estiver no carrinho)' })
  @ApiOkResponse({ type: CartDto })
  addItem(@SessionId() sessionId: string, @Body() body: AddCartItemDto): Promise<Cart> {
    return this.cart.addItem(sessionId, body);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Altera a quantidade de um item (0 remove)' })
  @ApiOkResponse({ type: CartDto })
  updateItem(
    @SessionId() sessionId: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateCartItemDto,
  ): Promise<Cart> {
    return this.cart.updateItem(sessionId, itemId, body.quantity);
  }

  @Delete()
  @ApiOperation({ summary: 'Esvazia o carrinho' })
  @ApiOkResponse({ type: CartDto })
  clear(@SessionId() sessionId: string): Promise<Cart> {
    return this.cart.clear(sessionId);
  }

  @Post('checkout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finaliza o pedido (simulado)' })
  @ApiOkResponse({ type: CheckoutDto })
  checkout(@SessionId() sessionId: string): Promise<Checkout> {
    return this.cart.checkout(sessionId);
  }
}

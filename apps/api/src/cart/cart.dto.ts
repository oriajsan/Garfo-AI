import { addCartItemSchema, cartSchema, checkoutSchema, updateCartItemSchema } from '@garfo/shared';
import { createZodDto } from 'nestjs-zod';

export class AddCartItemDto extends createZodDto(addCartItemSchema) {}
export class UpdateCartItemDto extends createZodDto(updateCartItemSchema) {}
export class CartDto extends createZodDto(cartSchema) {}
export class CheckoutDto extends createZodDto(checkoutSchema) {}

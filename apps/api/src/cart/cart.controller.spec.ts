import { type Cart, type Checkout } from '@garfo/shared';
import { CartController } from './cart.controller';
import { type CartService } from './cart.service';

describe('CartController', () => {
  const cart = { id: 'c1' } as Cart;
  const checkout: Checkout = { orderId: 'c1', totalCents: 100, estimatedMinutes: 30 };
  const service = {
    getCart: jest.fn().mockResolvedValue(cart),
    addItem: jest.fn().mockResolvedValue(cart),
    updateItem: jest.fn().mockResolvedValue(cart),
    clear: jest.fn().mockResolvedValue(cart),
    checkout: jest.fn().mockResolvedValue(checkout),
  };
  const controller = new CartController(service as unknown as CartService);

  it('delegates every route to the service with the session id', async () => {
    const body = { dishId: 'd1', quantity: 2 };
    await expect(controller.get('s1')).resolves.toBe(cart);
    await expect(controller.addItem('s1', body)).resolves.toBe(cart);
    await expect(controller.updateItem('s1', 'i1', { quantity: 0 })).resolves.toBe(cart);
    await expect(controller.clear('s1')).resolves.toBe(cart);
    await expect(controller.checkout('s1')).resolves.toBe(checkout);

    expect(service.addItem).toHaveBeenCalledWith('s1', body);
    expect(service.updateItem).toHaveBeenCalledWith('s1', 'i1', 0);
  });
});

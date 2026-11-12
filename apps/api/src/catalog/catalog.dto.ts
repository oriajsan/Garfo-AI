import {
  dishSearchResponseSchema,
  restaurantDetailSchema,
  restaurantSummarySchema,
  searchDishesQuerySchema,
} from '@garfo/shared';
import { createZodDto } from 'nestjs-zod';

export class SearchDishesQueryDto extends createZodDto(searchDishesQuerySchema) {}
export class DishSearchResponseDto extends createZodDto(dishSearchResponseSchema) {}
export class RestaurantSummaryDto extends createZodDto(restaurantSummarySchema) {}
export class RestaurantDetailDto extends createZodDto(restaurantDetailSchema) {}

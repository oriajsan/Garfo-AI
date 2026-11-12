import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DishSearchResponse,
  type RestaurantDetail,
  type RestaurantSummary,
} from '@garfo/shared';
import {
  DishSearchResponseDto,
  RestaurantDetailDto,
  RestaurantSummaryDto,
  SearchDishesQueryDto,
} from './catalog.dto';
import { SearchService } from './search.service';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: SearchService) {}

  @Get('restaurants')
  @ApiOperation({ summary: 'Lista restaurantes (sem pratos), por avaliação' })
  @ApiOkResponse({ type: [RestaurantSummaryDto] })
  listRestaurants(): Promise<RestaurantSummary[]> {
    return this.catalog.listRestaurants();
  }

  @Get('restaurants/:slug')
  @ApiOperation({ summary: 'Restaurante com os pratos disponíveis' })
  @ApiOkResponse({ type: RestaurantDetailDto })
  getRestaurant(@Param('slug') slug: string): Promise<RestaurantDetail> {
    return this.catalog.getRestaurant(slug);
  }

  @Get('dishes/search')
  @ApiOperation({ summary: 'Busca híbrida: filtros estruturados + similaridade semântica' })
  @ApiOkResponse({ type: DishSearchResponseDto })
  async search(@Query() query: SearchDishesQueryDto): Promise<DishSearchResponse> {
    return { results: await this.catalog.search(query) };
  }
}

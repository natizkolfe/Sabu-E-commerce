import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'catalog', schema: this.catalogService.schema, status: 'ok' };
  }

  @Public()
  @Get('categories')
  categories() {
    return this.catalogService.listCategories();
  }

  @Public()
  @Get('products')
  products(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalogService.listProducts({
      category,
      q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogService.getProductBySlug(slug);
  }
}

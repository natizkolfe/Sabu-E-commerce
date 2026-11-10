import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';

class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  nameAm?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'inactive', 'archived'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  bulkPurchasingEnabled?: boolean;
}

class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nameAm?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'inactive', 'archived'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  bulkPurchasingEnabled?: boolean;
}

class CreateVariantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  sku!: string;

  @IsOptional()
  @IsString()
  variantName?: string;

  @IsOptional()
  options?: Record<string, unknown>;
}

class UpdateVariantDto {
  @IsOptional()
  @IsString()
  variantName?: string;

  @IsOptional()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class SetAttributesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  attributeValueIds!: string[];
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'catalog',
      schema: this.catalogService.schema,
      status: 'ok',
    };
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
    @Query('bulk') bulk?: string,
  ) {
    return this.catalogService.listProducts({
      category,
      q,
      limit: limit ? Number(limit) : undefined,
      bulkOnly: bulk === '1' || bulk === 'true',
    });
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogService.getProductBySlug(slug);
  }

  @Get('admin/products')
  @RequirePermissions('catalog.write')
  adminProducts(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('bulk') bulk?: string,
  ) {
    return this.catalogService.adminListProducts({
      limit: limit ? Number(limit) : undefined,
      q,
      status,
      bulkOnly: bulk === '1' || bulk === 'true',
    });
  }

  @Get('admin/products/:id')
  @RequirePermissions('catalog.write')
  adminProduct(@Param('id') id: string) {
    return this.catalogService.adminGetProduct(id);
  }

  @Post('admin/products')
  @RequirePermissions('catalog.write')
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.catalogService.createProduct({ ...dto, actorId: user.id });
  }

  @Patch('admin/products/:id')
  @RequirePermissions('catalog.write')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalogService.updateProduct(id, dto);
  }

  @Post('admin/products/:id/variants')
  @RequirePermissions('catalog.write')
  createVariant(@Param('id') id: string, @Body() dto: CreateVariantDto) {
    return this.catalogService.createVariant({ productId: id, ...dto });
  }

  @Patch('admin/variants/:id')
  @RequirePermissions('catalog.write')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.catalogService.updateVariant(id, dto);
  }

  @Get('admin/attributes')
  @RequirePermissions('catalog.write')
  attributes() {
    return this.catalogService.listAttributes();
  }

  @Post('admin/variants/:id/attributes')
  @RequirePermissions('catalog.write')
  setAttributes(@Param('id') id: string, @Body() dto: SetAttributesDto) {
    return this.catalogService.setVariantAttributes(id, dto.attributeValueIds);
  }
}

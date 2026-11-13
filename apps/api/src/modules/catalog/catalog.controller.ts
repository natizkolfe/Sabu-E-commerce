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
  ValidateIf,
} from 'class-validator';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';

class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsUUID()
  brandId?: string;

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

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID()
  vendorId?: string | null;
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
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @IsBoolean()
  bulkPurchasingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  returnsAllowed?: boolean;

  @IsOptional()
  returnWindowDays?: number | null;

  @IsOptional()
  @IsString()
  returnConditions?: string | null;

  @IsOptional()
  @IsString()
  returnInstructions?: string | null;

  @IsOptional()
  @IsString()
  returnPolicyDescription?: string | null;

  @IsOptional()
  @IsString()
  returnPolicyEffectiveAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID()
  vendorId?: string | null;
}

class CreateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  sku?: string;

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

class CreateAttributeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  nameAm?: string | null;

  @IsOptional()
  @IsIn([
    'text',
    'number',
    'dropdown',
    'multi_select',
    'boolean',
    'color',
    'measurement',
  ])
  dataType?: string;

  @IsOptional()
  @IsString()
  unit?: string | null;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  sortOrder?: number;
}

class UpdateAttributeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nameAm?: string | null;

  @IsOptional()
  @IsIn([
    'text',
    'number',
    'dropdown',
    'multi_select',
    'boolean',
    'color',
    'measurement',
  ])
  dataType?: string;

  @IsOptional()
  @IsString()
  unit?: string | null;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  sortOrder?: number;
}

class CreateAttributeValueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  labelAm?: string | null;

  @IsOptional()
  sortOrder?: number;
}

class CreateBrandDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;
}

class AddProductImageDto {
  @IsString()
  @MinLength(3)
  storageKey!: string;

  @IsOptional()
  @IsString()
  altText?: string | null;

  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  source?: string;
}

class CreateCategoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  nameAm?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  featuredSort?: number;

  @IsOptional()
  @IsString()
  imageStorageKey?: string | null;

  @IsOptional()
  @IsString()
  iconStorageKey?: string | null;

  @IsOptional()
  @IsString()
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  metaDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  aiStudioEnabled?: boolean;
}

class UpdateCategoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  nameAm?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  featuredSort?: number;

  @IsOptional()
  @IsString()
  imageStorageKey?: string | null;

  @IsOptional()
  @IsString()
  iconStorageKey?: string | null;

  @IsOptional()
  @IsString()
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  metaDescription?: string | null;

  @IsOptional()
  @IsBoolean()
  aiStudioEnabled?: boolean;
}

class CategoryAttributeSetsDto {
  @IsArray()
  sets!: Array<{
    attributeId: string;
    isRequired?: boolean;
    sortOrder?: number;
  }>;
}

class ProductCategoriesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds!: string[];

  @IsOptional()
  @IsUUID()
  primaryCategoryId?: string;
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
  categories(
    @Query('tree') tree?: string,
    @Query('all') all?: string,
  ) {
    return this.catalogService.listCategories({
      tree: tree === '1' || tree === 'true',
      includeInactive: all === '1' || all === 'true',
    });
  }

  @Public()
  @Get('facets')
  facets(@Query('category') category?: string) {
    return this.catalogService.listFacets({ category });
  }

  @Public()
  @Get('products')
  products(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('bulk') bulk?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('brand') brand?: string,
    @Query('attribute') attribute?: string,
    @Query('inStock') inStock?: string,
    @Query('onSale') onSale?: string,
    @Query('newArrivals') newArrivals?: string,
    @Query('retail') retail?: string,
    @Query('wholesale') wholesale?: string,
    @Query('sort') sort?: string,
  ) {
    return this.catalogService.listProducts({
      category,
      q,
      limit: limit ? Number(limit) : undefined,
      bulkOnly: bulk === '1' || bulk === 'true',
      minPrice: minPrice != null ? Number(minPrice) : undefined,
      maxPrice: maxPrice != null ? Number(maxPrice) : undefined,
      brand,
      attribute,
      inStock: inStock === '1' || inStock === 'true',
      onSale: onSale === '1' || onSale === 'true',
      newArrivals: newArrivals === '1' || newArrivals === 'true',
      retailOnly: retail === '1' || retail === 'true',
      wholesaleOnly: wholesale === '1' || wholesale === 'true',
      sort,
    });
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogService.getProductBySlug(slug);
  }

  @Get('admin/categories')
  @RequirePermissions('catalog.write')
  adminCategories() {
    return this.catalogService.adminListCategories();
  }

  @Post('admin/categories')
  @RequirePermissions('catalog.write')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalogService.createCategory(dto);
  }

  @Patch('admin/categories/:id')
  @RequirePermissions('catalog.write')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalogService.updateCategory(id, dto);
  }

  @Get('admin/categories/:id/attributes')
  @RequirePermissions('catalog.write')
  categoryAttributes(@Param('id') id: string) {
    return this.catalogService.getCategoryAttributeSets(id);
  }

  @Post('admin/categories/:id/attributes')
  @RequirePermissions('catalog.write')
  setCategoryAttributes(
    @Param('id') id: string,
    @Body() dto: CategoryAttributeSetsDto,
  ) {
    return this.catalogService.setCategoryAttributeSets(id, dto.sets ?? []);
  }

  @Post('admin/products/:id/categories')
  @RequirePermissions('catalog.write')
  setProductCategories(
    @Param('id') id: string,
    @Body() dto: ProductCategoriesDto,
  ) {
    return this.catalogService.setProductCategories(
      id,
      dto.categoryIds,
      dto.primaryCategoryId,
    );
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

  @Post('admin/attributes')
  @RequirePermissions('catalog.write')
  createAttribute(@Body() dto: CreateAttributeDto) {
    return this.catalogService.createAttribute(dto);
  }

  @Patch('admin/attributes/:id')
  @RequirePermissions('catalog.write')
  updateAttribute(@Param('id') id: string, @Body() dto: UpdateAttributeDto) {
    return this.catalogService.updateAttribute(id, dto);
  }

  @Post('admin/attributes/:id/values')
  @RequirePermissions('catalog.write')
  addAttributeValue(
    @Param('id') id: string,
    @Body() dto: CreateAttributeValueDto,
  ) {
    return this.catalogService.addAttributeValue({
      attributeId: id,
      ...dto,
    });
  }

  @Get('admin/brands')
  @RequirePermissions('catalog.write')
  brands() {
    return this.catalogService.listBrands();
  }

  @Post('admin/brands')
  @RequirePermissions('catalog.write')
  createBrand(@Body() dto: CreateBrandDto) {
    return this.catalogService.createBrand(dto);
  }

  @Get('admin/products/:id/images')
  @RequirePermissions('catalog.write')
  productImages(@Param('id') id: string) {
    return this.catalogService.listProductImages(id);
  }

  @Post('admin/products/:id/images')
  @RequirePermissions('catalog.write')
  addProductImage(@Param('id') id: string, @Body() dto: AddProductImageDto) {
    return this.catalogService.addProductImage({
      productId: id,
      ...dto,
    });
  }

  @Post('admin/products/:id/images/:imageId/primary')
  @RequirePermissions('catalog.write')
  setPrimaryImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.catalogService.setPrimaryProductImage(id, imageId);
  }

  @Post('admin/products/:id/images/:imageId/delete')
  @RequirePermissions('catalog.write')
  deleteProductImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.catalogService.deleteProductImage(id, imageId);
  }

  @Post('admin/variants/:id/attributes')
  @RequirePermissions('catalog.write')
  setAttributes(@Param('id') id: string, @Body() dto: SetAttributesDto) {
    return this.catalogService.setVariantAttributes(id, dto.attributeValueIds);
  }
}

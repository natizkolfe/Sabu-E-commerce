import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;

  /** When true, set absolute qty instead of adding to existing line */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;
}

import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const CONTACT_CHANNELS = [
  'whatsapp',
  'telegram',
  'viber',
  'phone',
  'sms',
] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export class CheckoutDto {
  @IsOptional()
  @IsBoolean()
  asGuest?: boolean;

  @ValidateIf((o: CheckoutDto) => o.asGuest === true)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ValidateIf((o: CheckoutDto) => o.asGuest === true)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName!: string;

  @Matches(/^\+[1-9][0-9]{7,14}$/)
  recipientPhone!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  addressText!: string;

  @IsNumber()
  @Min(-180)
  lng!: number;

  @IsNumber()
  @Min(-90)
  lat!: number;

  @IsOptional()
  @IsIn(['local_delivery', 'store_pickup'])
  fulfillmentType?: 'local_delivery' | 'store_pickup' = 'local_delivery';

  @IsOptional()
  @IsIn(['RETAIL-ETB', 'WHOLESALE-ETB'])
  priceListCode?: 'RETAIL-ETB' | 'WHOLESALE-ETB' = 'RETAIL-ETB';

  @IsUUID()
  paymentMethodId!: string;

  /** How the customer wants order updates (guest-safe). */
  @IsIn([...CONTACT_CHANNELS])
  preferredContactChannel!: ContactChannel;

  @IsOptional()
  @IsBoolean()
  contactConsent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;

  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

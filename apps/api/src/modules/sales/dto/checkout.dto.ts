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

  /** Ethiopian mobile in E.164: +2519xxxxxxxx */
  @Matches(/^\+2519\d{8}$/, {
    message:
      'Please enter a valid Ethiopian phone number, such as 911123456.',
  })
  recipientPhone!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  addressText!: string;

  /** Confirmed delivery destination longitude (WGS84). */
  @IsNumber()
  @Min(-180)
  lng!: number;

  /** Confirmed delivery destination latitude (WGS84). */
  @IsNumber()
  @Min(-90)
  lat!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmarkName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmarkPlaceId?: string;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  landmarkLng?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  landmarkLat?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  formattedAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryInstructions?: string;

  @IsOptional()
  @IsIn(['exact', 'landmark_nearby'])
  locationType?: 'exact' | 'landmark_nearby';

  @IsOptional()
  @IsIn(['gps', 'search', 'manual_pin', 'admin', 'assisted'])
  locationSource?: 'gps' | 'search' | 'manual_pin' | 'admin' | 'assisted';

  /** Required for local_delivery: customer confirmed the pin/landmark. */
  @IsOptional()
  @IsBoolean()
  locationConfirmed?: boolean;

  @IsOptional()
  @IsIn(['local_delivery', 'store_pickup'])
  fulfillmentType?: 'local_delivery' | 'store_pickup' = 'local_delivery';

  /** Standard (default) or Express when admin-enabled. */
  @IsOptional()
  @IsIn(['standard', 'express'])
  deliveryServiceType?: 'standard' | 'express' = 'standard';

  @IsOptional()
  @IsIn(['RETAIL-ETB', 'WHOLESALE-ETB'])
  priceListCode?: 'RETAIL-ETB' | 'WHOLESALE-ETB' = 'RETAIL-ETB';

  @IsUUID()
  paymentMethodId!: string;

  /**
   * Payment transaction reference (Telebirr TXN / bank transfer ref).
   * Required for all manual-verification methods.
   */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  telebirrTxnId?: string;

  /** Selected company bank account (CBE or Other Banks). */
  @IsOptional()
  @IsUUID()
  companyBankAccountId?: string;

  /** Customer acknowledges the final payable amount before place order. */
  @IsOptional()
  @IsBoolean()
  amountAcknowledged?: boolean;

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

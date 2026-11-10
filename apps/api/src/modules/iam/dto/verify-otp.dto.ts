import { IsIn, IsOptional, IsString, Matches, Length } from 'class-validator';

export class VerifyOtpDto {
  @Matches(/^\+[1-9][0-9]{7,14}$/, {
    message: 'phone must be E.164 (e.g. +251911234567)',
  })
  phone!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;

  @IsOptional()
  @IsIn(['web', 'customer_app', 'driver_app', 'admin_web'])
  clientType?: 'web' | 'customer_app' | 'driver_app' | 'admin_web' = 'web';
}

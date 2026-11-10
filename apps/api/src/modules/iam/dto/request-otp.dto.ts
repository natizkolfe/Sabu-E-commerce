import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  @Matches(/^\+[1-9][0-9]{7,14}$/, {
    message: 'phone must be E.164 (e.g. +251911234567)',
  })
  phone!: string;

  @IsOptional()
  @IsIn(['login', 'verify_phone'])
  purpose?: 'login' | 'verify_phone' = 'login';

  @IsOptional()
  @IsIn(['web', 'customer_app', 'driver_app', 'admin_web'])
  clientType?: 'web' | 'customer_app' | 'driver_app' | 'admin_web' = 'web';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}

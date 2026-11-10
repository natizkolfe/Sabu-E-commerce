import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../iam/auth.types';
import { DeliveryService } from './delivery.service';

class OfferDto {
  @IsUUID()
  driverId!: string;
}

class DeclineDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class VerifyQrDto {
  @IsString()
  @MinLength(8)
  qrToken!: string;
}

class VerifyPinDto {
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  pin!: string;
}

class SettingsDto {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  offerTtlMinutes?: number;

  @IsOptional()
  defaultSpeedKmh?: number;
}

class CreateDriverDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phone!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  licenseNumber!: string;

  @IsDateString()
  licenseExpiry!: string;

  @IsOptional()
  @IsIn(['employee', 'contractor'])
  employmentType?: 'employee' | 'contractor';

  @IsOptional()
  @IsUUID()
  homeZoneId?: string;

  @IsOptional()
  @IsIn(['offline', 'available', 'on_break'])
  availability?: 'offline' | 'available' | 'on_break';

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

class UpdateDriverDto {
  @IsOptional()
  @IsIn(['offline', 'available', 'on_delivery', 'on_break'])
  availability?: 'offline' | 'available' | 'on_delivery' | 'on_break';

  @IsOptional()
  @IsIn(['pending_verification', 'active', 'suspended', 'terminated'])
  status?: 'pending_verification' | 'active' | 'suspended' | 'terminated';

  @IsOptional()
  @IsUUID()
  homeZoneId?: string;
}

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Public()
  @Get('health')
  health() {
    return {
      module: 'delivery',
      schema: this.deliveryService.schema,
      status: 'ok',
    };
  }

  // ——— Admin ———
  @Get('admin/queue')
  @RequirePermissions('delivery.dispatch')
  queue() {
    return this.deliveryService.listDispatchQueue();
  }

  @Get('admin/deliveries')
  @RequirePermissions('delivery.read')
  deliveries(@Query('status') status?: string) {
    return this.deliveryService.listDeliveries(status);
  }

  @Get('admin/deliveries/:id')
  @RequirePermissions('delivery.read')
  delivery(@Param('id') id: string) {
    return this.deliveryService.getDeliveryAdmin(id);
  }

  @Get('admin/drivers')
  @RequirePermissions('delivery.dispatch')
  drivers(@Query('all') all?: string) {
    if (all === '1' || all === 'true') {
      return this.deliveryService.listDrivers();
    }
    return this.deliveryService.listAvailableDrivers();
  }

  @Get('admin/zones')
  @RequirePermissions('delivery.dispatch')
  zones() {
    return this.deliveryService.listZones();
  }

  @Post('admin/drivers')
  @RequirePermissions('delivery.dispatch')
  createDriver(@CurrentUser() user: AuthUser, @Body() dto: CreateDriverDto) {
    return this.deliveryService.createDriver(user, dto);
  }

  @Put('admin/drivers/:id')
  @RequirePermissions('delivery.dispatch')
  updateDriver(@Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.deliveryService.updateDriver(id, dto);
  }

  @Post('admin/orders/:orderId/create')
  @RequirePermissions('delivery.dispatch')
  createFromOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
  ) {
    return this.deliveryService.createDeliveryFromOrder(user, orderId);
  }

  @Post('admin/deliveries/:id/offer')
  @RequirePermissions('delivery.dispatch')
  offer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: OfferDto,
  ) {
    return this.deliveryService.offerToDriver(user, id, dto.driverId);
  }

  @Post('admin/deliveries/:id/reissue-verification')
  @RequirePermissions('delivery.dispatch')
  reissue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deliveryService.reissueVerification(user, id);
  }

  @Get('admin/settings')
  @RequirePermissions('delivery.dispatch')
  settings() {
    return this.deliveryService.getSettings();
  }

  @Put('admin/settings')
  @RequirePermissions('delivery.dispatch')
  updateSettings(@Body() dto: SettingsDto) {
    return this.deliveryService.updateSettings(dto);
  }

  // ——— Public driver portal (tokenized) ———
  @Public()
  @Get('offers')
  getOffer(@Query('token') token: string) {
    return this.deliveryService.getOfferByToken(token);
  }

  @Public()
  @Post('offers/accept')
  accept(@Body() body: { token: string }) {
    return this.deliveryService.acceptOffer(body.token);
  }

  @Public()
  @Post('offers/decline')
  decline(@Body() body: DeclineDto & { token: string }) {
    return this.deliveryService.declineOffer(body.token, body.reason);
  }

  @Public()
  @Get('driver/dashboard')
  dashboard(@Query('token') token: string) {
    return this.deliveryService.getDriverDashboard(token);
  }

  @Public()
  @Post('driver/verify-qr')
  verifyQr(@Body() body: VerifyQrDto & { token: string }) {
    return this.deliveryService.verifyWithQr(body.token, body.qrToken);
  }

  @Public()
  @Post('driver/verify-pin')
  verifyPin(@Body() body: VerifyPinDto & { token: string }) {
    return this.deliveryService.verifyWithPin(body.token, body.pin);
  }

  @Public()
  @Post('driver/confirm')
  confirm(@Body() body: { token: string }) {
    return this.deliveryService.confirmDelivery(body.token);
  }

  @Public()
  @Get('customer/track')
  customerTrack(
    @Query('orderNumber') orderNumber: string,
    @Query('token') token: string,
  ) {
    return this.deliveryService.getCustomerDeliveryArtifacts(
      orderNumber,
      token,
    );
  }
}

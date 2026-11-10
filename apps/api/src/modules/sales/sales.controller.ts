import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../iam/auth.types';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Public()
  @Get('health')
  health() {
    return { module: 'sales', schema: this.salesService.schema, status: 'ok' };
  }

  @Get('cart')
  @RequirePermissions('orders.write')
  getCart(@CurrentUser() user: AuthUser) {
    return this.salesService.getCart(user);
  }

  @Post('cart/items')
  @RequirePermissions('orders.write')
  addItem(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.salesService.addItem(user, dto);
  }

  @Patch('cart/items/:itemId')
  @RequirePermissions('orders.write')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.salesService.updateItem(user, itemId, dto.quantity);
  }

  @Delete('cart/items/:itemId')
  @RequirePermissions('orders.write')
  removeItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.salesService.removeItem(user, itemId);
  }

  @Public()
  @Get('guest/cart')
  getGuestCart(@Headers('x-guest-token') guestToken?: string) {
    return this.salesService.getGuestCart(requireGuestToken(guestToken));
  }

  @Public()
  @Post('guest/cart/items')
  addGuestItem(
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body() dto: AddCartItemDto,
  ) {
    return this.salesService.addGuestItem(requireGuestToken(guestToken), dto);
  }

  @Public()
  @Patch('guest/cart/items/:itemId')
  updateGuestItem(
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.salesService.updateGuestItem(
      requireGuestToken(guestToken),
      itemId,
      dto.quantity,
    );
  }

  @Public()
  @Delete('guest/cart/items/:itemId')
  removeGuestItem(
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('itemId') itemId: string,
  ) {
    return this.salesService.removeGuestItem(
      requireGuestToken(guestToken),
      itemId,
    );
  }

  @Public()
  @Post('checkout')
  checkoutGuest(
    @Body() dto: CheckoutDto,
    @Headers('x-guest-token') guestToken: string | undefined,
  ) {
    return this.salesService.checkout(
      { ...dto, asGuest: true },
      { guestToken: requireGuestToken(guestToken) },
    );
  }

  @Post('checkout/auth')
  @RequirePermissions('orders.write')
  checkoutAuth(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.salesService.checkout({ ...dto, asGuest: false }, { user });
  }

  @Public()
  @Get('orders/track')
  track(
    @Query('orderNumber') orderNumber: string,
    @Query('token') token: string,
    @Query('phone') phone?: string,
  ) {
    return this.salesService.trackOrder(orderNumber, token, phone);
  }

  @Public()
  @Post('orders/track/recover')
  recoverTrack(
    @Body() body: { orderNumber: string; phone: string },
  ) {
    return this.salesService.recoverTrackByPhone(body.orderNumber, body.phone);
  }

  @Get('admin/orders')
  @RequirePermissions('orders.read')
  adminOrders(
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('qaStatus') qaStatus?: string,
    @Query('contactStatus') contactStatus?: string,
    @Query('q') q?: string,
    @Query('requiresManualContact') requiresManualContact?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesService.adminListOrders({
      status,
      paymentStatus,
      approvalStatus,
      qaStatus,
      contactStatus,
      q,
      requiresManualContact:
        requiresManualContact === '1' || requiresManualContact === 'true'
          ? true
          : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('admin/orders/:orderId')
  @RequirePermissions('orders.read')
  adminOrder(@Param('orderId') orderId: string) {
    return this.salesService.adminGetOrder(orderId);
  }

  @Patch('admin/orders/:orderId/status')
  @RequirePermissions('orders.write')
  adminOrderStatus(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: { status: string; reason?: string },
  ) {
    return this.salesService.adminUpdateOrderStatus(
      user,
      orderId,
      body.status,
      body.reason,
    );
  }

  @Post('admin/orders/:orderId/approve')
  @RequirePermissions('orders.write')
  adminApproveOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body?: { notes?: string },
  ) {
    return this.salesService.adminApproveOrder(user, orderId, body?.notes);
  }

  @Post('admin/orders/:orderId/reject-approval')
  @RequirePermissions('orders.write')
  adminRejectOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body?: { notes?: string },
  ) {
    return this.salesService.adminRejectOrder(user, orderId, body?.notes);
  }

  @Post('admin/orders/:orderId/qa')
  @RequirePermissions('orders.write')
  adminQa(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body()
    body: {
      result: 'passed' | 'failed';
      notes?: string;
      checkedQtyOk?: boolean;
      variantsOk?: boolean;
      packagingOk?: boolean;
    },
  ) {
    return this.salesService.adminQaReview(user, orderId, body);
  }

  @Post('admin/orders/:orderId/contact-cases')
  @RequirePermissions('orders.write')
  adminOpenContactCase(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body()
    body: {
      reasonCode: string;
      title?: string;
      details?: string;
      priority?: string;
      followUpAt?: string;
    },
  ) {
    return this.salesService.adminOpenContactCase(user, orderId, body);
  }

  @Post('admin/orders/:orderId/contact-cases/resolve')
  @RequirePermissions('orders.write')
  adminResolveContactCase(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body?: { caseId?: string; notes?: string; closeAll?: boolean },
  ) {
    return this.salesService.adminResolveContactCase(user, orderId, body ?? {});
  }

  @Post('admin/orders/:orderId/contact-attempts')
  @RequirePermissions('orders.write')
  adminContactAttempt(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body()
    body: {
      channel: string;
      outcome: string;
      notes?: string;
      clearManualFlag?: boolean;
    },
  ) {
    return this.salesService.adminRecordContactAttempt(user, orderId, body);
  }

  @Post('admin/orders/:orderId/notifications/resend')
  @RequirePermissions('orders.write')
  adminResendNotification(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body?: { eventCode?: string },
  ) {
    return this.salesService.adminResendNotification(
      user,
      orderId,
      body?.eventCode ?? 'order.placed',
    );
  }

  @Get('orders')
  @RequirePermissions('orders.read')
  listOrders(@CurrentUser() user: AuthUser) {
    return this.salesService.listMyOrders(user);
  }

  @Get('orders/:orderId')
  @RequirePermissions('orders.read')
  getOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.salesService.getOrder(user, orderId);
  }
}

function requireGuestToken(token?: string) {
  if (!token) throw new UnauthorizedException('X-Guest-Token header required');
  return token;
}

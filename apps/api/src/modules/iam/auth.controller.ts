import { Body, Controller, Get, Post, Req, Headers } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  requestOtp(
    @Body() dto: RequestOtpDto,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string } },
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    return this.auth.requestOtp(dto, ip);
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    return this.auth.verifyOtp(dto, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    return this.auth.refresh(dto.refreshToken, ip, userAgent);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.sessionId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

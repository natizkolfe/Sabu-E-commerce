import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from './twilio.service';
import { WhatsAppService } from './whatsapp.service';

export type OtpDeliveryChannel = 'sms' | 'whatsapp' | 'dev';

export type OtpDeliveryResult = {
  channel: OtpDeliveryChannel;
  ok: boolean;
  status: string;
  /** Twilio Verify generated the code — verify via checkSmsOtp(). */
  providerManagedCode?: boolean;
  error?: string | null;
  deepLink?: string | null;
};

/** Stored as otp_challenges.code_hash when Twilio Verify owns the code. */
export const TWILIO_VERIFY_MARKER = 'provider:twilio_verify';

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly twilio: TwilioService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * US (+1) → Twilio SMS / Verify.
   * Ethiopia (+251) → WhatsApp.
   */
  resolveChannel(phoneE164: string): OtpDeliveryChannel {
    if (phoneE164.startsWith('+1')) return 'sms';
    if (phoneE164.startsWith('+251')) return 'whatsapp';
    return 'whatsapp';
  }

  async deliverOtp(phoneE164: string, code: string): Promise<OtpDeliveryResult> {
    const channel = this.resolveChannel(phoneE164);
    const brand = this.config.get<string>('OTP_BRAND_NAME')?.trim() || 'Sabu';
    const text = `${brand} login code: ${code}. Expires in 10 minutes. Do not share this code.`;

    if (channel === 'sms') {
      const sms = await this.twilio.sendLoginOtp(phoneE164, code);
      if (sms.ok) {
        return {
          channel: 'sms',
          ok: true,
          status: sms.status,
          providerManagedCode: Boolean(sms.providerManagedCode),
        };
      }
      this.logger.warn(
        `OTP SMS failed for ${phoneE164}: ${sms.error ?? sms.status}`,
      );
      return {
        channel: 'sms',
        ok: false,
        status: sms.status,
        error: sms.error,
      };
    }

    const wa = await this.whatsapp.sendOtp(phoneE164, code, text);
    if (wa.ok && wa.status === 'sent') {
      return {
        channel: 'whatsapp',
        ok: true,
        status: wa.status,
        deepLink: wa.deepLink,
      };
    }

    return {
      channel: 'whatsapp',
      ok: wa.ok && wa.status !== 'failed',
      status: wa.status,
      error: wa.error,
      deepLink: wa.deepLink,
    };
  }

  async checkSmsOtp(phoneE164: string, code: string) {
    return this.twilio.checkVerification(phoneE164, code);
  }

  usesTwilioVerify() {
    return this.twilio.isVerifyConfigured();
  }
}

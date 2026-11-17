import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from './twilio.service';
import { WhatsAppService } from './whatsapp.service';

export type OtpDeliveryChannel = 'sms' | 'whatsapp' | 'dev';

export type OtpDeliveryResult = {
  channel: OtpDeliveryChannel;
  ok: boolean;
  status: string;
  error?: string | null;
  deepLink?: string | null;
};

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly twilio: TwilioService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * US (+1) → Twilio SMS.
   * Ethiopia (+251) → WhatsApp.
   * Others → WhatsApp first, then SMS if configured.
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
      const sms = await this.twilio.sendSms(phoneE164, text);
      if (sms.ok) {
        return { channel: 'sms', ok: true, status: sms.status };
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

    // Cloud failed or wa.me-only: still report channel so UI can guide.
    return {
      channel: 'whatsapp',
      ok: wa.ok && wa.status !== 'failed',
      status: wa.status,
      error: wa.error,
      deepLink: wa.deepLink,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TwilioSmsResult = {
  ok: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  sid?: string | null;
  error?: string | null;
};

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim() &&
        this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim() &&
        this.config.get<string>('TWILIO_FROM_NUMBER')?.trim(),
    );
  }

  async sendSms(toE164: string, body: string): Promise<TwilioSmsResult> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim();
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    const from = this.config.get<string>('TWILIO_FROM_NUMBER')?.trim();

    if (!accountSid || !authToken || !from) {
      return {
        ok: false,
        status: 'not_configured',
        error: 'Twilio is not configured',
        sid: null,
      };
    }

    try {
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const params = new URLSearchParams({
        To: toE164,
        From: from,
        Body: body,
      });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
        error_message?: string;
      };
      if (!res.ok) {
        const err =
          json.message ?? json.error_message ?? `Twilio HTTP ${res.status}`;
        this.logger.warn(`[twilio] SMS failed to ${toE164}: ${err}`);
        return { ok: false, status: 'failed', error: err, sid: null };
      }
      this.logger.log(`[twilio] SMS sent to ${toE164} sid=${json.sid ?? '-'}`);
      return { ok: true, status: 'sent', sid: json.sid ?? null, error: null };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`[twilio] exception: ${message}`);
      return { ok: false, status: 'failed', error: message, sid: null };
    }
  }
}

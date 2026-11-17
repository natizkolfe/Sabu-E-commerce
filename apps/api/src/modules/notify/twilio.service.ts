import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TwilioSmsResult = {
  ok: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  /** When true, Twilio Verify owns the code — check via checkVerification(). */
  providerManagedCode?: boolean;
  sid?: string | null;
  error?: string | null;
};

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim();
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    if (!accountSid || !authToken) return null;
    return {
      accountSid,
      authToken,
      authHeader:
        'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
    };
  }

  isConfigured() {
    return Boolean(this.credentials());
  }

  isVerifyConfigured() {
    return Boolean(
      this.credentials() &&
        this.config.get<string>('TWILIO_VERIFY_SERVICE_SID')?.trim(),
    );
  }

  /**
   * Prefer Twilio Verify (works on trial). Else Content template SID.
   * Plain Body SMS only works on upgraded (non-trial) accounts.
   */
  async sendLoginOtp(toE164: string, code: string): Promise<TwilioSmsResult> {
    if (this.isVerifyConfigured()) {
      return this.startVerification(toE164);
    }

    const contentSid = this.config.get<string>('TWILIO_CONTENT_SID')?.trim();
    if (contentSid) {
      return this.sendContentSms(toE164, contentSid, code);
    }

    const brand = this.config.get<string>('OTP_BRAND_NAME')?.trim() || 'Sabu';
    return this.sendSms(
      toE164,
      `${brand} login code: ${code}. Expires in 10 minutes. Do not share this code.`,
    );
  }

  async startVerification(toE164: string): Promise<TwilioSmsResult> {
    const creds = this.credentials();
    const serviceSid = this.config
      .get<string>('TWILIO_VERIFY_SERVICE_SID')
      ?.trim();
    if (!creds || !serviceSid) {
      return {
        ok: false,
        status: 'not_configured',
        error: 'Twilio Verify is not configured',
        sid: null,
      };
    }

    try {
      const params = new URLSearchParams({
        To: toE164,
        Channel: 'sms',
      });
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        sid?: string;
        status?: string;
        message?: string;
      };
      if (!res.ok) {
        const err = json.message ?? `Twilio Verify HTTP ${res.status}`;
        this.logger.warn(`[twilio verify] start failed ${toE164}: ${err}`);
        return { ok: false, status: 'failed', error: err, sid: null };
      }
      this.logger.log(
        `[twilio verify] started for ${toE164} status=${json.status ?? '-'}`,
      );
      return {
        ok: true,
        status: 'sent',
        providerManagedCode: true,
        sid: json.sid ?? null,
        error: null,
      };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`[twilio verify] exception: ${message}`);
      return { ok: false, status: 'failed', error: message, sid: null };
    }
  }

  async checkVerification(
    toE164: string,
    code: string,
  ): Promise<{ ok: boolean; error?: string | null }> {
    const creds = this.credentials();
    const serviceSid = this.config
      .get<string>('TWILIO_VERIFY_SERVICE_SID')
      ?.trim();
    if (!creds || !serviceSid) {
      return { ok: false, error: 'Twilio Verify is not configured' };
    }

    try {
      const params = new URLSearchParams({
        To: toE164,
        Code: code,
      });
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        valid?: boolean;
        message?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          error: json.message ?? `Twilio Verify check HTTP ${res.status}`,
        };
      }
      const ok = json.status === 'approved' || json.valid === true;
      return { ok, error: ok ? null : 'Invalid or expired code' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async sendContentSms(
    toE164: string,
    contentSid: string,
    code: string,
  ): Promise<TwilioSmsResult> {
    const creds = this.credentials();
    const from = this.config.get<string>('TWILIO_FROM_NUMBER')?.trim();
    if (!creds || !from) {
      return {
        ok: false,
        status: 'not_configured',
        error: 'Twilio is not configured',
        sid: null,
      };
    }

    try {
      const params = new URLSearchParams({
        To: toE164,
        From: from,
        ContentSid: contentSid,
        ContentVariables: JSON.stringify({ 1: code }),
      });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.authHeader,
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
        this.logger.warn(`[twilio content] failed ${toE164}: ${err}`);
        return { ok: false, status: 'failed', error: err, sid: null };
      }
      this.logger.log(`[twilio content] sent to ${toE164} sid=${json.sid}`);
      return { ok: true, status: 'sent', sid: json.sid ?? null, error: null };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`[twilio content] exception: ${message}`);
      return { ok: false, status: 'failed', error: message, sid: null };
    }
  }

  async sendSms(toE164: string, body: string): Promise<TwilioSmsResult> {
    const creds = this.credentials();
    const from = this.config.get<string>('TWILIO_FROM_NUMBER')?.trim();

    if (!creds || !from) {
      return {
        ok: false,
        status: 'not_configured',
        error: 'Twilio is not configured',
        sid: null,
      };
    }

    try {
      const params = new URLSearchParams({
        To: toE164,
        From: from,
        Body: body,
      });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.authHeader,
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

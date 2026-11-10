import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type WhatsAppSendResult = {
  ok: boolean;
  mode: 'cloud' | 'wa_me';
  status: 'sent' | 'pending_click' | 'failed';
  providerMessageId?: string | null;
  deepLink?: string | null;
  error?: string | null;
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  isCloudConfigured() {
    return Boolean(
      this.config.get<string>('WHATSAPP_TOKEN')?.trim() &&
        this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim(),
    );
  }

  /** Digits only, country code included (no +). */
  normalizePhone(phone: string) {
    return phone.replace(/[^\d]/g, '');
  }

  buildWaMeLink(phone: string, text: string) {
    const to = this.normalizePhone(phone);
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  }

  /**
   * Prefer Meta Cloud API when credentials exist; otherwise return a wa.me
   * deep link the customer/admin can open to deliver the same message.
   */
  async sendText(phone: string, text: string): Promise<WhatsAppSendResult> {
    const deepLink = this.buildWaMeLink(phone, text);
    const forceMode = (
      this.config.get<string>('WHATSAPP_MODE') ?? 'auto'
    ).toLowerCase();

    const useCloud =
      forceMode === 'cloud' || (forceMode === 'auto' && this.isCloudConfigured());

    if (!useCloud) {
      this.logger.log(
        `[whatsapp wa.me] Ready for ${this.normalizePhone(phone)} → ${deepLink.slice(0, 80)}…`,
      );
      return {
        ok: true,
        mode: 'wa_me',
        status: 'pending_click',
        deepLink,
        providerMessageId: null,
        error: null,
      };
    }

    const token = this.config.get<string>('WHATSAPP_TOKEN')!.trim();
    const phoneNumberId = this.config
      .get<string>('WHATSAPP_PHONE_NUMBER_ID')!
      .trim();
    const apiVersion =
      this.config.get<string>('WHATSAPP_API_VERSION')?.trim() || 'v21.0';
    const to = this.normalizePhone(phone);

    try {
      const res = await fetch(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: true, body: text },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        const err =
          body.error?.message ?? `WhatsApp API HTTP ${res.status}`;
        this.logger.warn(`[whatsapp cloud] failed: ${err}`);
        return {
          ok: false,
          mode: 'cloud',
          status: 'failed',
          deepLink,
          error: err,
          providerMessageId: null,
        };
      }
      const id = body.messages?.[0]?.id ?? null;
      this.logger.log(`[whatsapp cloud] sent to ${to} id=${id}`);
      return {
        ok: true,
        mode: 'cloud',
        status: 'sent',
        providerMessageId: id,
        deepLink,
        error: null,
      };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`[whatsapp cloud] exception: ${message}`);
      return {
        ok: false,
        mode: 'cloud',
        status: 'failed',
        deepLink,
        error: message,
        providerMessageId: null,
      };
    }
  }
}

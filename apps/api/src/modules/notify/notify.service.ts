import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { WhatsAppService } from './whatsapp.service';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
};

/**
 * Outbox drain: delivers WhatsApp via Cloud API when configured,
 * otherwise prepares a wa.me deep link (pending_click) and logs the attempt.
 */
@Injectable()
export class NotifyService implements OnModuleInit {
  readonly schema = 'notify' as const;
  private readonly logger = new Logger(NotifyService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.drainOutbox().catch((err) =>
        this.logger.warn(`Outbox drain failed: ${(err as Error).message}`),
      );
    }, 5000);
    this.timer.unref?.();
  }

  async drainOutbox(limit = 20) {
    const { rows } = await this.db.query<OutboxRow>(
      `SELECT id::text, event_type, aggregate_id::text, payload
       FROM core.outbox_events
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT $1`,
      [limit],
    );

    for (const row of rows) {
      try {
        await this.handleEvent(row);
      } catch (err) {
        this.logger.warn(
          `Notify handle failed for ${row.event_type}: ${(err as Error).message}`,
        );
      }
      await this.db.query(
        `UPDATE core.outbox_events
         SET published_at = now(), attempts = attempts + 1
         WHERE id = $1::bigint`,
        [row.id],
      );
    }
    return { processed: rows.length };
  }

  /** Manual / admin test send to a phone. */
  async sendTestWhatsApp(phone: string, message?: string) {
    const text =
      message?.trim() ||
      `Sabu Online Shopping test: WhatsApp delivery is working. (${new Date().toISOString()})`;
    const result = await this.whatsapp.sendText(phone, text);
    return {
      phone: this.whatsapp.normalizePhone(phone),
      ...result,
      message: text,
    };
  }

  buildOrderWhatsAppMessage(input: {
    eventType: string;
    orderNumber: string | null;
    trackingUrl: string | null;
    recipientName?: string | null;
    grandTotal?: string | number | null;
  }) {
    return buildMessagePreview({
      eventType: input.eventType,
      orderNumber: input.orderNumber,
      trackingUrl: input.trackingUrl,
      channel: 'whatsapp',
      requiresManual: false,
      recipientName: input.recipientName ?? null,
      grandTotal:
        input.grandTotal == null ? null : String(input.grandTotal),
    });
  }

  private async handleEvent(row: OutboxRow) {
    const payload = row.payload ?? {};

    // Driver offers are phone-call only — never WhatsApp drivers.
    // Aggregate id is the assignment, not an order — skip order notification logs.
    const driverOfferEvent =
      row.event_type === 'delivery.offer_whatsapp' ||
      row.event_type === 'delivery.offer_created';
    if (driverOfferEvent) {
      this.logger.log(
        `[notify] ${row.event_type} skipped (phone-call driver contact)`,
      );
      return;
    }

    const orderId =
      (typeof payload.orderId === 'string' && payload.orderId) ||
      (row.event_type.startsWith('order.') ||
      row.event_type.startsWith('payment.') ||
      row.event_type.startsWith('delivery.')
        ? row.aggregate_id
        : null);

    if (!orderId) {
      this.logger.log(
        `[notify] ${row.event_type} (no order) → ${JSON.stringify(payload)}`,
      );
      return;
    }

    const channel = resolveChannel(payload);
    const phone =
      typeof payload.phone === 'string'
        ? payload.phone
        : typeof payload.recipientPhone === 'string'
          ? payload.recipientPhone
          : null;
    const destination = maskPhone(phone) ?? 'unknown';
    const requiresManual =
      payload.requiresManualContact === true ||
      channel === 'phone' ||
      channel === 'sms';
    const trackingUrl =
      typeof payload.trackingUrl === 'string' ? payload.trackingUrl : null;
    const orderNumber =
      typeof payload.orderNumber === 'string' ? payload.orderNumber : null;
    const recipientName =
      typeof payload.recipientName === 'string' ? payload.recipientName : null;
    const grandTotal =
      payload.grandTotal != null ? String(payload.grandTotal) : null;

    const preview = buildMessagePreview({
      eventType: row.event_type,
      orderNumber,
      trackingUrl,
      channel,
      requiresManual,
      recipientName,
      grandTotal,
    });

    let status: string;
    let lastError: string | null = null;
    let provider: string | null = null;
    let deepLink: string | null = null;
    let providerMessageId: string | null = null;

    if (requiresManual && messagingChannel(channel)) {
      status = 'skipped_manual';
      lastError =
        'Customer prefers phone/SMS or messaging unavailable — admin must contact manually';
    } else if (requiresManual) {
      status = 'skipped_manual';
      lastError = 'Manual phone contact required';
    } else if (channel === 'whatsapp' && phone) {
      const result = await this.whatsapp.sendText(phone, preview);
      deepLink = result.deepLink ?? null;
      providerMessageId = result.providerMessageId ?? null;
      provider =
        result.mode === 'cloud' ? 'whatsapp_cloud' : 'whatsapp_wa_me';
      status =
        result.status === 'sent'
          ? 'sent'
          : result.status === 'pending_click'
            ? 'pending_click'
            : 'failed';
      lastError = result.error ?? null;
      if (result.status === 'pending_click') {
        lastError =
          'WhatsApp Cloud API not configured — open wa.me deep link to deliver';
      }
    } else if (messagingChannel(channel)) {
      status = 'stubbed';
      provider = `${channel}_stub`;
      this.logger.log(
        `[notify stub] ${row.event_type} via ${channel} → ${destination}: ${preview}`,
      );
    } else {
      status = 'stubbed';
      provider = `${channel}_stub`;
    }

    if (status === 'skipped_manual') {
      await this.db.query(
        `UPDATE sales.orders
         SET requires_manual_contact = true, updated_at = now()
         WHERE id = $1::uuid`,
        [orderId],
      );
    }

    await this.db.query(
      `INSERT INTO notify.order_notification_logs (
         order_id, event_code, channel, destination_masked, status,
         provider, message_preview, payload, last_error, attempt_count,
         outbox_event_id, sent_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5,
         $6, $7, $8::jsonb, $9, 1,
         $10::bigint, CASE WHEN $5 IN ('sent','delivered','stubbed','pending_click') THEN now() ELSE NULL END
       )`,
      [
        orderId,
        row.event_type,
        channel,
        destination,
        status,
        provider,
        preview,
        JSON.stringify({
          ...payload,
          trackToken: undefined,
          whatsappDeepLink: deepLink,
          providerMessageId,
        }),
        lastError,
        row.id,
      ],
    );
  }
}

function resolveChannel(payload: Record<string, unknown>): string {
  const preferred = payload.preferredContactChannel;
  if (typeof preferred === 'string' && preferred) return preferred;
  const channel = payload.channel;
  if (typeof channel === 'string' && channel) return channel;
  return 'whatsapp';
}

function messagingChannel(channel: string) {
  return ['whatsapp', 'telegram', 'viber'].includes(channel);
}

function maskPhone(phone: string | null) {
  if (!phone) return null;
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function buildMessagePreview(opts: {
  eventType: string;
  orderNumber: string | null;
  trackingUrl: string | null;
  channel: string;
  requiresManual: boolean;
  recipientName?: string | null;
  grandTotal?: string | null;
}) {
  const num = opts.orderNumber ?? 'your order';
  const name = opts.recipientName ? ` ${opts.recipientName}` : '';
  if (opts.requiresManual) {
    return `Admin queue: contact customer about #${num} (preferred: ${opts.channel})`;
  }
  const track = opts.trackingUrl ? `\nTrack: ${opts.trackingUrl}` : '';
  const total =
    opts.grandTotal != null ? `\nTotal: ETB ${opts.grandTotal}` : '';
  switch (opts.eventType) {
    case 'order.placed':
      return `Sabu Online Shopping: Hi${name}, order #${num} was received successfully.${total}${track}\nWe will confirm payment and delivery next.`;
    case 'payment.verified':
    case 'payment.succeeded':
      return `Sabu Online Shopping: Payment verified for order #${num}.${track}\nEstimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays.`;
    case 'delivery.offer_created':
      return `Admin: call the driver and share the secure offer link for #${num}`;
    case 'delivery.offer_whatsapp':
      // Legacy event — drivers are phone-call only now
      return `Admin: call the driver for #${num} (WhatsApp to drivers disabled)`;
    case 'delivery.customer_whatsapp':
    case 'delivery.accepted':
      return `Sabu Online Shopping: Your order #${num} is out for delivery. You can call your driver directly.${track}\nEstimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays.`;
    case 'delivery.completed':
      return `Sabu Online Shopping: Order #${num} was delivered. Thank you!`;
    default:
      return `Sabu Online Shopping: Update for order #${num} (${opts.eventType}).${track}`;
  }
}

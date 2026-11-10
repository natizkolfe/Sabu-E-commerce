import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
};

/**
 * Outbox drain: logs every notification attempt to notify.order_notification_logs.
 * Messaging providers are stubbed until BSP/Telegram/Viber credentials are configured.
 * Phone/SMS preference or missing consent → skipped_manual (admin must call).
 */
@Injectable()
export class NotifyService implements OnModuleInit {
  readonly schema = 'notify' as const;
  private readonly logger = new Logger(NotifyService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DatabaseService) {}

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

  private async handleEvent(row: OutboxRow) {
    const payload = row.payload ?? {};
    const orderId =
      (typeof payload.orderId === 'string' && payload.orderId) ||
      (row.event_type.startsWith('order.') ||
      row.event_type.startsWith('payment.') ||
      row.event_type.startsWith('delivery.')
        ? row.aggregate_id
        : null);

    if (!orderId) {
      this.logger.log(
        `[notify stub] ${row.event_type} (no order) → ${JSON.stringify(payload)}`,
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

    const preview = buildMessagePreview({
      eventType: row.event_type,
      orderNumber,
      trackingUrl,
      channel,
      requiresManual,
    });

    let status: string;
    let lastError: string | null = null;
    let provider: string | null = null;

    if (requiresManual && messagingChannel(channel)) {
      status = 'skipped_manual';
      lastError =
        'Customer prefers phone/SMS or messaging unavailable — admin must contact manually';
    } else if (requiresManual) {
      status = 'skipped_manual';
      lastError = 'Manual phone contact required';
    } else if (!providerConfigured(channel)) {
      // Stub success so ops can see the intended send in admin logs
      status = 'stubbed';
      provider = `${channel}_stub`;
      this.logger.log(
        `[notify stub] ${row.event_type} via ${channel} → ${destination}: ${preview}`,
      );
    } else {
      status = 'stubbed';
      provider = `${channel}_stub`;
    }

    // Mark order for manual contact if messaging was skipped
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
         $10::bigint, CASE WHEN $5 IN ('sent','delivered','stubbed') THEN now() ELSE NULL END
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
          // never persist raw track token in logs long-term if present
          trackToken: undefined,
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

function providerConfigured(_channel: string) {
  // Real BSP keys not wired yet — always stub
  return false;
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
}) {
  const num = opts.orderNumber ?? 'your order';
  if (opts.requiresManual) {
    return `Admin queue: contact customer about #${num} (preferred: ${opts.channel})`;
  }
  const track = opts.trackingUrl ? ` Track: ${opts.trackingUrl}` : '';
  switch (opts.eventType) {
    case 'order.placed':
      return `Order #${num} received successfully.${track}`;
    case 'payment.verified':
    case 'payment.succeeded':
      return `Payment verified for order #${num}.${track}`;
    case 'delivery.offer_whatsapp':
      return `Driver offer for delivery related to #${num}`;
    case 'delivery.customer_whatsapp':
    case 'delivery.accepted':
      return `Your order #${num} is out for delivery.${track}`;
    case 'delivery.completed':
      return `Order #${num} was delivered. Thank you!`;
    default:
      return `Update for order #${num} (${opts.eventType}).${track}`;
  }
}

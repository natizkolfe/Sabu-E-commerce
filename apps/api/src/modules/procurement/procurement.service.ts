import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { normalizeEthiopianPhone } from '../../common/phone';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

@Injectable()
export class ProcurementService {
  readonly schema = 'procurement' as const;

  constructor(private readonly db: DatabaseService) {}

  async listPartners() {
    const { rows } = await this.db.query<{
      id: string;
      code: string;
      name: string;
      country_code: string;
      city: string | null;
      contact_name: string | null;
      whatsapp_e164: string | null;
      contact_email: string | null;
      is_active: boolean;
      partner_portal_enabled: boolean;
    }>(
      `SELECT id, code, name, country_code, city, contact_name,
              whatsapp_e164, contact_email, is_active, partner_portal_enabled
       FROM procurement.suppliers
       WHERE supplier_type = 'international' AND deleted_at IS NULL
       ORDER BY country_code, name`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      countryCode: r.country_code,
      city: r.city,
      contactName: r.contact_name,
      whatsapp: r.whatsapp_e164,
      email: r.contact_email,
      isActive: r.is_active,
      portalEnabled: r.partner_portal_enabled,
    }));
  }

  async listSpecialOrders(opts?: { status?: string; limit?: number }) {
    const limit = Math.min(opts?.limit ?? 100, 200);
    const params: unknown[] = [];
    const where = ['TRUE'];
    if (opts?.status) {
      params.push(opts.status);
      where.push(`r.status = $${params.length}`);
    }
    params.push(limit);
    const { rows } = await this.db.query<{
      id: string;
      request_number: string;
      product_name: string;
      description: string | null;
      status: string;
      quantity: number;
      product_url: string | null;
      customer_instructions: string | null;
      preferred_contact_channel: string | null;
      guest_first_name: string | null;
      guest_last_name: string | null;
      guest_phone_e164: string | null;
      region_code: string;
      region_name: string;
      created_at: Date;
      image_count: string;
    }>(
      `SELECT r.id, r.request_number, r.product_name, r.description, r.status,
              r.quantity, r.product_url, r.customer_instructions,
              r.preferred_contact_channel,
              r.guest_first_name, r.guest_last_name, r.guest_phone_e164,
              reg.code AS region_code, reg.name AS region_name, r.created_at,
              (SELECT count(*)::text FROM procurement.special_order_attachments a
               WHERE a.request_id = r.id) AS image_count
       FROM procurement.special_order_requests r
       JOIN core.operating_regions reg ON reg.id = r.sourcing_region_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      requestNumber: r.request_number,
      productName: r.product_name,
      description: r.description,
      status: r.status,
      statusLabel: specialOrderStatusLabel(r.status),
      quantity: r.quantity,
      productUrl: r.product_url,
      customerInstructions: r.customer_instructions,
      preferredContactChannel: r.preferred_contact_channel,
      guestName: [r.guest_first_name, r.guest_last_name]
        .filter(Boolean)
        .join(' '),
      guestPhone: r.guest_phone_e164,
      sourcingRegion: r.region_code,
      sourcingRegionName: r.region_name,
      imageCount: Number(r.image_count),
      createdAt: r.created_at,
    }));
  }

  async getSpecialOrder(id: string) {
    const { rows } = await this.db.query<{
      id: string;
      request_number: string;
      product_name: string;
      description: string | null;
      status: string;
      quantity: number;
      product_url: string | null;
      customer_instructions: string | null;
      preferred_contact_channel: string | null;
      guest_first_name: string | null;
      guest_last_name: string | null;
      guest_phone_e164: string | null;
      region_code: string;
      region_name: string;
      created_at: Date;
    }>(
      `SELECT r.id, r.request_number, r.product_name, r.description, r.status,
              r.quantity, r.product_url, r.customer_instructions,
              r.preferred_contact_channel,
              r.guest_first_name, r.guest_last_name, r.guest_phone_e164,
              reg.code AS region_code, reg.name AS region_name, r.created_at
       FROM procurement.special_order_requests r
       JOIN core.operating_regions reg ON reg.id = r.sourcing_region_id
       WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Special order not found');
    const r = rows[0];

    const { rows: images } = await this.db.query<{
      id: string;
      storage_key: string;
      mime_type: string;
      size_bytes: number;
    }>(
      `SELECT id, storage_key, mime_type, size_bytes
       FROM procurement.special_order_attachments
       WHERE request_id = $1 ORDER BY created_at`,
      [id],
    );

    const { rows: history } = await this.db.query<{
      id: string;
      from_status: string | null;
      to_status: string;
      note: string | null;
      changed_at: Date;
    }>(
      `SELECT id::text, from_status, to_status, note, changed_at
       FROM procurement.special_order_status_history
       WHERE request_id = $1 ORDER BY changed_at DESC`,
      [id],
    );

    return {
      id: r.id,
      requestNumber: r.request_number,
      productName: r.product_name,
      description: r.description,
      status: r.status,
      statusLabel: specialOrderStatusLabel(r.status),
      quantity: r.quantity,
      productUrl: r.product_url,
      customerInstructions: r.customer_instructions,
      preferredContactChannel: r.preferred_contact_channel,
      guestFirstName: r.guest_first_name,
      guestLastName: r.guest_last_name,
      guestName: [r.guest_first_name, r.guest_last_name]
        .filter(Boolean)
        .join(' '),
      guestPhone: r.guest_phone_e164,
      sourcingRegion: r.region_code,
      sourcingRegionName: r.region_name,
      createdAt: r.created_at,
      images: images.map((img) => ({
        id: img.id,
        storageKey: img.storage_key,
        mimeType: img.mime_type,
        sizeBytes: img.size_bytes,
        url: `/media/file?key=${encodeURIComponent(img.storage_key)}`,
      })),
      history: history.map((h) => ({
        id: h.id,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        toStatusLabel: specialOrderStatusLabel(h.to_status),
        note: h.note,
        changedAt: h.changed_at,
      })),
      copyText: buildSpecialOrderCopyText({
        requestNumber: r.request_number,
        guestName: [r.guest_first_name, r.guest_last_name]
          .filter(Boolean)
          .join(' '),
        guestPhone: r.guest_phone_e164,
        preferredContactChannel: r.preferred_contact_channel,
        productName: r.product_name,
        description: r.description,
        quantity: r.quantity,
        sourcingRegionName: r.region_name,
        productUrl: r.product_url,
        customerInstructions: r.customer_instructions,
        statusLabel: specialOrderStatusLabel(r.status),
      }),
    };
  }

  async updateSpecialOrderStatus(
    user: AuthUser,
    id: string,
    status: string,
    note?: string,
  ) {
    if (!SPECIAL_ORDER_STATUSES.includes(status as (typeof SPECIAL_ORDER_STATUSES)[number])) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    const { rows } = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM procurement.special_order_requests WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Special order not found');
    const from = rows[0].status;
    if (from === status) return this.getSpecialOrder(id);

    await this.db.query(
      `UPDATE procurement.special_order_requests
       SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status],
    );
    await this.db.query(
      `INSERT INTO procurement.special_order_status_history
         (request_id, from_status, to_status, note, changed_by, is_customer_visible)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [id, from, status, note ?? 'Admin status update', user.id],
    );
    return this.getSpecialOrder(id);
  }

  async createSpecialOrder(body: {
    firstName: string;
    lastName: string;
    phone: string;
    sourcingRegionCode: 'US' | 'CN' | 'AE-DXB';
    productName: string;
    description: string;
    quantity?: number;
    preferredContactChannel?: string;
    productUrl?: string;
    customerInstructions?: string;
    imageStorageKeys: string[];
    imageMimeTypes?: string[];
    imageSizes?: number[];
  }) {
    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new BadRequestException('First and last name are required');
    }
    const phone = normalizeEthiopianPhone(body.phone);
    if (!phone) {
      throw new BadRequestException(
        'Please enter a valid Ethiopian phone number, such as 911123456.',
      );
    }
    if (!body.productName?.trim() || !body.description?.trim()) {
      throw new BadRequestException('Product name and description required');
    }
    if (!body.imageStorageKeys?.length) {
      throw new BadRequestException(
        'At least one product reference image is required',
      );
    }
    const channel = body.preferredContactChannel ?? 'whatsapp';
    if (!['whatsapp', 'telegram', 'phone'].includes(channel)) {
      throw new BadRequestException('Invalid preferred communication method');
    }
    if (body.productUrl?.trim()) {
      try {
        const u = new URL(body.productUrl.trim());
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new Error('bad protocol');
        }
      } catch {
        throw new BadRequestException('Product website link must be a valid URL');
      }
    }

    const { rows: regions } = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM core.operating_regions WHERE code = $1 AND is_active`,
      [body.sourcingRegionCode],
    );
    if (!regions[0]) {
      throw new BadRequestException('Please select Dubai, China, or USA');
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const customerId = await this.upsertGuestCustomer(
        client,
        phone,
        body.firstName,
        body.lastName,
      );
      const requestNumber = await this.nextDocNumber(client, 'SR');
      const qty = Math.max(1, Math.floor(Number(body.quantity) || 1));
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO procurement.special_order_requests (
           request_number, customer_id, sourcing_region_id, product_name,
           description, quantity, status, product_url, customer_instructions,
           guest_first_name, guest_last_name, guest_phone_e164,
           preferred_contact_channel
         ) VALUES (
           $1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,$10,$11,$12
         ) RETURNING id`,
        [
          requestNumber,
          customerId,
          regions[0].id,
          body.productName.trim(),
          body.description.trim(),
          qty,
          body.productUrl?.trim() || null,
          body.customerInstructions?.trim() || null,
          body.firstName.trim(),
          body.lastName.trim(),
          phone,
          channel,
        ],
      );
      const requestId = rows[0].id;

      await client.query(
        `INSERT INTO procurement.special_order_status_history
           (request_id, from_status, to_status, note, is_customer_visible)
         VALUES ($1, NULL, 'submitted', 'Guest special-order submitted', true)`,
        [requestId],
      );

      let i = 0;
      for (const key of body.imageStorageKeys) {
        const mime = body.imageMimeTypes?.[i] ?? 'image/jpeg';
        if (!['image/jpeg', 'image/png'].includes(mime)) {
          throw new BadRequestException(
            'Please upload an image in JPG, JPEG, or PNG format.',
          );
        }
        const size = Math.max(1, Number(body.imageSizes?.[i] ?? 1));
        if (size > 1024 * 1024) {
          throw new BadRequestException(
            'Your image must be less than 1 MB. Please select a smaller image.',
          );
        }
        await client.query(
          `INSERT INTO procurement.special_order_attachments (
             request_id, storage_key, mime_type, size_bytes, scan_status, uploaded_by
           ) VALUES ($1,$2,$3,$4,'pending',NULL)`,
          [requestId, key, mime, size],
        );
        i += 1;
      }

      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('special_order', $1, 'special_order.submitted', $2::jsonb)`,
        [
          requestId,
          JSON.stringify({
            requestId,
            requestNumber,
            phone,
            sourcingRegion: body.sourcingRegionCode,
            preferredContactChannel: channel,
          }),
        ],
      );

      await client.query('COMMIT');
      return {
        id: requestId,
        requestNumber,
        status: 'submitted',
        statusLabel: specialOrderStatusLabel('submitted'),
        productName: body.productName.trim(),
        guestName: `${body.firstName.trim()} ${body.lastName.trim()}`.trim(),
        sourcingRegion: body.sourcingRegionCode,
        sourcingRegionName: regions[0].name,
        quantity: qty,
        submittedAt: new Date().toISOString(),
        message:
          'Thank you for submitting your special order request!',
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async assignPartner(
    user: AuthUser,
    requestId: string,
    supplierId: string,
  ) {
    const { rows: req } = await this.db.query<{
      id: string;
      request_number: string;
      status: string;
    }>(
      `SELECT id, request_number, status FROM procurement.special_order_requests WHERE id = $1`,
      [requestId],
    );
    if (!req[0]) throw new NotFoundException('Special order not found');

    const { rows: supplier } = await this.db.query<{
      id: string;
      name: string;
      whatsapp_e164: string | null;
    }>(`SELECT id, name, whatsapp_e164 FROM procurement.suppliers WHERE id = $1`, [
      supplierId,
    ]);
    if (!supplier[0]) throw new NotFoundException('Partner not found');

    const { rows: assignment } = await this.db.query<{ id: string }>(
      `INSERT INTO procurement.partner_assignments
         (request_id, supplier_id, status, sent_at, created_by)
       VALUES ($1,$2,'sent', now(), $3)
       ON CONFLICT (request_id, supplier_id) DO UPDATE
         SET status = 'sent', sent_at = now()
       RETURNING id`,
      [requestId, supplierId, user.id],
    );

    const fromStatus = req[0].status;
    await this.db.query(
      `UPDATE procurement.special_order_requests
       SET status = 'sourcing', supplier_id = $2, updated_at = now()
       WHERE id = $1`,
      [requestId, supplierId],
    );
    if (fromStatus !== 'sourcing') {
      await this.db.query(
        `INSERT INTO procurement.special_order_status_history
           (request_id, from_status, to_status, note, changed_by, is_customer_visible)
         VALUES ($1, $2, 'sourcing', $3, $4, true)`,
        [
          requestId,
          fromStatus,
          `Assigned to partner ${supplier[0].name}`,
          user.id,
        ],
      );
    }

    await this.db.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('special_order', $1, 'special_order.partner_request', $2::jsonb)`,
      [
        requestId,
        JSON.stringify({
          requestId,
          requestNumber: req[0].request_number,
          partnerId: supplierId,
          partnerName: supplier[0].name,
          whatsapp: supplier[0].whatsapp_e164,
          channel: 'whatsapp',
          assignmentId: assignment[0].id,
        }),
      ],
    );

    return {
      ok: true,
      assignmentId: assignment[0].id,
      message: 'Partner request queued (WhatsApp stub)',
    };
  }

  private async upsertGuestCustomer(
    client: PoolClient,
    phone: string,
    firstName: string,
    lastName: string,
  ) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM crm.customers WHERE is_guest = true AND phone_e164 = $1`,
      [phone],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const code = await this.nextDocNumber(client, 'CUS');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO crm.customers (
         user_id, customer_type, customer_code, is_guest, first_name, last_name, phone_e164
       ) VALUES (NULL, 'retail', $1, true, $2, $3, $4)
       RETURNING id`,
      [code, firstName, lastName, phone],
    );
    return rows[0].id;
  }

  private async nextDocNumber(client: PoolClient, docType: string) {
    const period = String(new Date().getUTCFullYear());
    await client.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ($1, $2, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
      [docType, period],
    );
    const { rows } = await client.query<{ next_value: string }>(
      `UPDATE core.document_sequences SET next_value = next_value + 1
       WHERE doc_type = $1 AND period = $2
       RETURNING (next_value - 1)::text AS next_value`,
      [docType, period],
    );
    return `${docType}-${period}-${String(Number(rows[0].next_value)).padStart(6, '0')}`;
  }
}

export const SPECIAL_ORDER_STATUSES = [
  'submitted',
  'under_review',
  'searching_for_product',
  'sourcing',
  'product_found',
  'quotation_sent',
  'quotation_prepared',
  'awaiting_customer_confirmation',
  'awaiting_customer_approval',
  'awaiting_payment',
  'payment_verification_pending',
  'payment_confirmed',
  'purchased',
  'purchasing',
  'shipped',
  'in_transit',
  'arrived_in_ethiopia',
  'arrived_ethiopia',
  'ready_for_delivery',
  'delivered',
  'product_unavailable',
  'unavailable',
  'cancelled',
] as const;

export function specialOrderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    submitted: 'Request Received',
    under_review: 'Under Review',
    searching_for_product: 'Searching for Product',
    sourcing: 'Searching for Product',
    product_found: 'Product Found',
    quotation_sent: 'Quotation Sent',
    quotation_prepared: 'Quotation Sent',
    awaiting_customer_confirmation: 'Awaiting Customer Confirmation',
    awaiting_customer_approval: 'Awaiting Customer Confirmation',
    awaiting_payment: 'Awaiting Payment',
    payment_verification_pending: 'Payment Verification Pending',
    payment_confirmed: 'Payment Confirmed',
    purchased: 'Purchased',
    purchasing: 'Purchased',
    shipped: 'Shipped',
    in_transit: 'Shipped',
    arrived_in_ethiopia: 'Arrived in Ethiopia',
    arrived_ethiopia: 'Arrived in Ethiopia',
    ready_for_delivery: 'Ready for Delivery',
    delivered: 'Delivered',
    product_unavailable: 'Product Unavailable',
    unavailable: 'Product Unavailable',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

function buildSpecialOrderCopyText(input: {
  requestNumber: string;
  guestName: string;
  guestPhone: string | null;
  preferredContactChannel: string | null;
  productName: string;
  description: string | null;
  quantity: number;
  sourcingRegionName: string;
  productUrl: string | null;
  customerInstructions: string | null;
  statusLabel: string;
}) {
  return [
    `Special Order ${input.requestNumber}`,
    `Status: ${input.statusLabel}`,
    `Customer: ${input.guestName}`,
    `Phone: ${input.guestPhone ?? '—'}`,
    `Preferred contact: ${input.preferredContactChannel ?? '—'}`,
    `Country: ${input.sourcingRegionName}`,
    `Product: ${input.productName}`,
    `Qty: ${input.quantity}`,
    `Description: ${input.description ?? '—'}`,
    input.productUrl ? `Link: ${input.productUrl}` : null,
    input.customerInstructions
      ? `Instructions: ${input.customerInstructions}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

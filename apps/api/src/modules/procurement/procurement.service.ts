import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
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
      status: string;
      quantity: number;
      guest_first_name: string | null;
      guest_last_name: string | null;
      guest_phone_e164: string | null;
      region_code: string;
      region_name: string;
      created_at: Date;
      image_count: string;
    }>(
      `SELECT r.id, r.request_number, r.product_name, r.status, r.quantity,
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
      status: r.status,
      quantity: r.quantity,
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

  async createSpecialOrder(body: {
    firstName: string;
    lastName: string;
    phone: string;
    sourcingRegionCode: 'US' | 'CN' | 'AE-DXB';
    productName: string;
    description: string;
    quantity?: number;
    preferredContactChannel?: string;
    imageStorageKeys: string[];
    imageMimeTypes?: string[];
  }) {
    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new BadRequestException('First and last name are required');
    }
    if (!/^\+[1-9][0-9]{7,14}$/.test(body.phone)) {
      throw new BadRequestException('Phone must be E.164');
    }
    if (!body.productName?.trim() || !body.description?.trim()) {
      throw new BadRequestException('Product name and description required');
    }
    if (!body.imageStorageKeys?.length) {
      throw new BadRequestException(
        'At least one product reference image is required',
      );
    }

    const { rows: regions } = await this.db.query<{ id: string }>(
      `SELECT id FROM core.operating_regions WHERE code = $1 AND is_active`,
      [body.sourcingRegionCode],
    );
    if (!regions[0]) {
      throw new BadRequestException('Invalid sourcing region');
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const customerId = await this.upsertGuestCustomer(
        client,
        body.phone,
        body.firstName,
        body.lastName,
      );
      const requestNumber = await this.nextDocNumber(client, 'SR');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO procurement.special_order_requests (
           request_number, customer_id, sourcing_region_id, product_name,
           description, quantity, status,
           guest_first_name, guest_last_name, guest_phone_e164,
           preferred_contact_channel
         ) VALUES (
           $1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,$10
         ) RETURNING id`,
        [
          requestNumber,
          customerId,
          regions[0].id,
          body.productName.trim(),
          body.description.trim(),
          body.quantity ?? 1,
          body.firstName.trim(),
          body.lastName.trim(),
          body.phone,
          body.preferredContactChannel ?? 'whatsapp',
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
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
          throw new BadRequestException(`Unsupported image type: ${mime}`);
        }
        await client.query(
          `INSERT INTO procurement.special_order_attachments (
             request_id, storage_key, mime_type, size_bytes, scan_status, uploaded_by
           ) VALUES ($1,$2,$3,1,'pending',NULL)`,
          [requestId, key, mime],
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
            phone: body.phone,
            sourcingRegion: body.sourcingRegionCode,
            preferredContactChannel: body.preferredContactChannel ?? 'whatsapp',
          }),
        ],
      );

      await client.query('COMMIT');
      return {
        id: requestId,
        requestNumber,
        status: 'submitted',
        message:
          'Special order received. Our team will review and contact you.',
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
    const { rows: req } = await this.db.query<{ id: string; request_number: string }>(
      `SELECT id, request_number FROM procurement.special_order_requests WHERE id = $1`,
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

    await this.db.query(
      `UPDATE procurement.special_order_requests
       SET status = 'sourcing', supplier_id = $2, updated_at = now()
       WHERE id = $1`,
      [requestId, supplierId],
    );
    await this.db.query(
      `INSERT INTO procurement.special_order_status_history
         (request_id, from_status, to_status, note, changed_by)
       VALUES ($1, 'submitted', 'sourcing', $2, $3)`,
      [
        requestId,
        `Assigned to partner ${supplier[0].name}`,
        user.id,
      ],
    );

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

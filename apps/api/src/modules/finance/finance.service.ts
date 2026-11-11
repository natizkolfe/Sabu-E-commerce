import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/** Owns PostgreSQL schema finance. Cross-module side effects via core.outbox_events. */
@Injectable()
export class FinanceService {
  readonly schema = 'finance' as const;

  constructor(private readonly db: DatabaseService) {}

  async listCustomerReceipts(opts?: { limit?: number }) {
    const limit = Math.min(opts?.limit ?? 100, 200);
    const { rows } = await this.db.query<{
      id: string;
      receipt_number: string;
      order_id: string;
      order_number: string;
      order_type: string;
      special_order_request_id: string | null;
      request_number: string | null;
      customer_name: string;
      customer_phone: string | null;
      payment_method_code: string | null;
      payment_status: string;
      subtotal: string;
      delivery_fee: string;
      tax_total: string;
      discount_total: string;
      grand_total: string;
      currency: string;
      created_at: Date;
    }>(
      `SELECT r.id, r.receipt_number, r.order_id, o.order_number, o.order_type,
              o.special_order_request_id, sor.request_number,
              r.customer_name, r.customer_phone, r.payment_method_code,
              r.payment_status, r.subtotal::text, r.delivery_fee::text,
              r.tax_total::text, r.discount_total::text, r.grand_total::text,
              r.currency, r.created_at
       FROM finance.customer_receipts r
       JOIN sales.orders o ON o.id = r.order_id
       LEFT JOIN procurement.special_order_requests sor
         ON sor.id = o.special_order_request_id
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      orderType: r.order_type,
      specialOrderRequestId: r.special_order_request_id,
      specialOrderNumber: r.request_number,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      paymentMethodCode: r.payment_method_code,
      paymentStatus: r.payment_status,
      subtotal: Number(r.subtotal),
      deliveryFee: Number(r.delivery_fee),
      taxTotal: Number(r.tax_total),
      discountTotal: Number(r.discount_total),
      grandTotal: Number(r.grand_total),
      currency: r.currency,
      createdAt: r.created_at,
    }));
  }

  async getCustomerReceipt(idOrNumber: string) {
    const { rows } = await this.db.query<{
      id: string;
      receipt_number: string;
      order_id: string;
      order_number: string;
      order_type: string;
      special_order_request_id: string | null;
      request_number: string | null;
      product_name: string | null;
      customer_name: string;
      customer_phone: string | null;
      payment_method_code: string | null;
      payment_status: string;
      subtotal: string;
      delivery_fee: string;
      tax_total: string;
      discount_total: string;
      grand_total: string;
      currency: string;
      qr_payload: string | null;
      line_items: unknown;
      created_at: Date;
    }>(
      `SELECT r.id, r.receipt_number, r.order_id, o.order_number, o.order_type,
              o.special_order_request_id, sor.request_number, sor.product_name,
              r.customer_name, r.customer_phone, r.payment_method_code,
              r.payment_status, r.subtotal::text, r.delivery_fee::text,
              r.tax_total::text, r.discount_total::text, r.grand_total::text,
              r.currency, r.qr_payload, r.line_items, r.created_at
       FROM finance.customer_receipts r
       JOIN sales.orders o ON o.id = r.order_id
       LEFT JOIN procurement.special_order_requests sor
         ON sor.id = o.special_order_request_id
       WHERE r.id::text = $1 OR r.receipt_number = $1
       LIMIT 1`,
      [idOrNumber],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Receipt not found');
    return {
      id: r.id,
      receiptNumber: r.receipt_number,
      orderId: r.order_id,
      orderNumber: r.order_number,
      orderType: r.order_type,
      specialOrderRequestId: r.special_order_request_id,
      specialOrderNumber: r.request_number,
      productName: r.product_name,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      paymentMethodCode: r.payment_method_code,
      paymentStatus: r.payment_status,
      subtotal: Number(r.subtotal),
      deliveryFee: Number(r.delivery_fee),
      taxTotal: Number(r.tax_total),
      discountTotal: Number(r.discount_total),
      grandTotal: Number(r.grand_total),
      currency: r.currency,
      qrPayload: r.qr_payload,
      lineItems: r.line_items,
      createdAt: r.created_at,
    };
  }

  /**
   * Create (or return existing) customer receipt for a paid/confirmed order.
   */
  async ensureReceiptForOrder(orderId: string) {
    const existing = await this.db.query<{ id: string; receipt_number: string }>(
      `SELECT id, receipt_number FROM finance.customer_receipts WHERE order_id = $1`,
      [orderId],
    );
    if (existing.rows[0]) {
      return this.getCustomerReceipt(existing.rows[0].id);
    }

    const { rows: orders } = await this.db.query<{
      id: string;
      order_number: string;
      payment_status: string;
      subtotal: string;
      delivery_fee: string;
      tax_total: string;
      discount_total: string;
      grand_total: string;
      currency: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      guest_phone_e164: string | null;
    }>(
      `SELECT id, order_number, payment_status, subtotal::text, delivery_fee::text,
              tax_total::text, discount_total::text, grand_total::text, currency,
              ship_recipient_name, ship_recipient_phone, guest_phone_e164
       FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    const order = orders[0];
    if (!order) throw new NotFoundException('Order not found');

    const { rows: items } = await this.db.query<{
      name_snapshot: string;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT name_snapshot, quantity, unit_price::text, line_total::text
       FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
      [orderId],
    );

    const receiptNumber = await this.nextReceiptNumber();
    const customerName = order.ship_recipient_name ?? 'Customer';
    const customerPhone =
      order.ship_recipient_phone ?? order.guest_phone_e164 ?? null;
    const lineItems = items.map((i) => ({
      name: i.name_snapshot,
      qty: i.quantity,
      unitPrice: Number(i.unit_price),
      lineTotal: Number(i.line_total),
    }));

    const { rows: created } = await this.db.query<{ id: string }>(
      `INSERT INTO finance.customer_receipts (
         receipt_number, order_id, customer_name, customer_phone,
         payment_method_code, payment_status, subtotal, delivery_fee,
         tax_total, discount_total, grand_total, currency, qr_payload, line_items
       ) VALUES (
         $1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb
       ) RETURNING id`,
      [
        receiptNumber,
        orderId,
        customerName,
        customerPhone,
        order.payment_status,
        Number(order.subtotal),
        Number(order.delivery_fee),
        Number(order.tax_total),
        Number(order.discount_total),
        Number(order.grand_total),
        order.currency,
        `sabu://receipt/${receiptNumber}`,
        JSON.stringify(lineItems),
      ],
    );

    return this.getCustomerReceipt(created[0].id);
  }

  private async nextReceiptNumber() {
    const period = String(new Date().getUTCFullYear());
    await this.db.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ('RCP', $1, 1) ON CONFLICT (doc_type, period) DO NOTHING`,
      [period],
    );
    const { rows } = await this.db.query<{ next_value: string }>(
      `UPDATE core.document_sequences SET next_value = next_value + 1
       WHERE doc_type = 'RCP' AND period = $1
       RETURNING (next_value - 1)::text AS next_value`,
      [period],
    );
    return `RCP-${period}-${String(Number(rows[0].next_value)).padStart(6, '0')}`;
  }
}

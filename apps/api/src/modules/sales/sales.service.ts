import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuthUser } from '../iam/auth.types';
import { PricingService } from '../pricing/pricing.service';
import { AddCartItemDto } from './dto/cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';

type CartRow = {
  id: string;
  customer_id: string | null;
  currency: string;
  status: string;
};

@Injectable()
export class SalesService {
  readonly schema = 'sales' as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly pricing: PricingService,
  ) {}

  async getCart(user: AuthUser) {
    const customerId = await this.requireCustomerId(user.id);
    const cart = await this.getOrCreateCustomerCart(customerId);
    return this.loadCartView(cart.id);
  }

  async addItem(user: AuthUser, dto: AddCartItemDto) {
    const customerId = await this.requireCustomerId(user.id);
    const cart = await this.getOrCreateCustomerCart(customerId);
    return this.addItemToCart(cart.id, dto);
  }

  async updateItem(user: AuthUser, itemId: string, quantity: number) {
    const customerId = await this.requireCustomerId(user.id);
    const cart = await this.getOrCreateCustomerCart(customerId);
    return this.updateCartItem(cart.id, itemId, quantity);
  }

  async removeItem(user: AuthUser, itemId: string) {
    const customerId = await this.requireCustomerId(user.id);
    const cart = await this.getOrCreateCustomerCart(customerId);
    return this.removeCartItem(cart.id, itemId);
  }

  // ——— Guest cart ———

  async getGuestCart(guestToken: string) {
    const cart = await this.getOrCreateGuestCart(guestToken);
    return this.loadCartView(cart.id);
  }

  async addGuestItem(guestToken: string, dto: AddCartItemDto) {
    const cart = await this.getOrCreateGuestCart(guestToken);
    return this.addItemToCart(cart.id, dto);
  }

  async updateGuestItem(guestToken: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreateGuestCart(guestToken);
    return this.updateCartItem(cart.id, itemId, quantity);
  }

  async removeGuestItem(guestToken: string, itemId: string) {
    const cart = await this.getOrCreateGuestCart(guestToken);
    return this.removeCartItem(cart.id, itemId);
  }

  async checkout(
    dto: CheckoutDto,
    opts: { user?: AuthUser; guestToken?: string },
  ) {
    const fulfillmentType = dto.fulfillmentType ?? 'local_delivery';
    const deliveryFee = fulfillmentType === 'local_delivery' ? 150 : 0;
    const listCode = dto.priceListCode ?? 'RETAIL-ETB';
    const preferredChannel = dto.preferredContactChannel;
    if (!preferredChannel) {
      throw new BadRequestException('preferredContactChannel is required');
    }
    const requiresManualContact =
      preferredChannel === 'phone' || preferredChannel === 'sms';
    const contactConsentAt =
      dto.contactConsent === false ? null : new Date().toISOString();

    if (dto.idempotencyKey) {
      const existing = await this.findByIdempotency(dto.idempotencyKey);
      if (existing) return existing;
    }

    let customerId: string;
    let cartId: string;
    let isGuest = false;

    if (dto.asGuest || (!opts.user && opts.guestToken)) {
      if (!dto.firstName || !dto.lastName) {
        throw new BadRequestException('Guest checkout requires first and last name');
      }
      if (!opts.guestToken) {
        throw new BadRequestException('X-Guest-Token required for guest checkout');
      }
      isGuest = true;
      customerId = await this.upsertGuestCustomer(
        dto.recipientPhone,
        dto.firstName,
        dto.lastName,
        preferredChannel,
      );
      const cart = await this.getOrCreateGuestCart(opts.guestToken);
      cartId = cart.id;
    } else {
      if (!opts.user) throw new UnauthorizedException('Authentication required');
      customerId = await this.requireCustomerId(opts.user.id);
      const cart = await this.getOrCreateCustomerCart(customerId);
      cartId = cart.id;
      await this.db.query(
        `UPDATE crm.customers
         SET preferred_contact_channel = $2, updated_at = now()
         WHERE id = $1`,
        [customerId, preferredChannel],
      );
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');

      const { rows: carts } = await client.query<CartRow>(
        `SELECT id, customer_id, currency, status FROM sales.carts WHERE id = $1 FOR UPDATE`,
        [cartId],
      );
      if (!carts[0] || carts[0].status !== 'active') {
        throw new BadRequestException('Cart is not active');
      }

      const { rows: rawLines } = await client.query<{
        item_id: string;
        variant_id: string;
        quantity: number;
        sku: string;
        product_name: string;
        variant_name: string | null;
        bulk_purchasing_enabled: boolean;
      }>(
        `SELECT ci.id AS item_id, ci.variant_id, ci.quantity, pv.sku,
                p.name AS product_name, pv.variant_name, p.bulk_purchasing_enabled
         FROM sales.cart_items ci
         JOIN catalog.product_variants pv ON pv.id = ci.variant_id
         JOIN catalog.products p ON p.id = pv.product_id
         WHERE ci.cart_id = $1
         FOR UPDATE OF ci`,
        [cartId],
      );
      if (!rawLines.length) throw new BadRequestException('Cart is empty');

      const priced = [];
      for (const line of rawLines) {
        const code =
          listCode === 'WHOLESALE-ETB' && line.bulk_purchasing_enabled
            ? 'WHOLESALE-ETB'
            : 'RETAIL-ETB';
        const price = await this.pricing.resolveUnitPrice(
          line.variant_id,
          line.quantity,
          code,
        );
        priced.push({
          ...line,
          unit: price.unitPrice,
          lineTotal: round2(price.unitPrice * line.quantity),
          priceListItemId: price.priceListItemId,
        });
      }

      const { rows: warehouses } = await client.query<{ id: string }>(
        `SELECT id FROM inventory.warehouses
         WHERE code = 'ADD-MAIN' AND is_active AND is_sellable LIMIT 1`,
      );
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) throw new BadRequestException('No sellable warehouse');

      const { rows: regions } = await client.query<{ id: string }>(
        `SELECT id FROM core.operating_regions WHERE code = 'ET' LIMIT 1`,
      );
      const regionId = regions[0]?.id;
      if (!regionId) throw new BadRequestException('ET region missing');

      for (const line of priced) {
        const { rowCount } = await client.query(
          `UPDATE inventory.stock_balances
           SET qty_reserved = qty_reserved + $1, version = version + 1, updated_at = now()
           WHERE warehouse_id = $2 AND variant_id = $3
             AND qty_on_hand - qty_reserved >= $1`,
          [line.quantity, warehouseId, line.variant_id],
        );
        if (!rowCount) {
          throw new ConflictException(
            `Insufficient stock for ${line.product_name} (${line.sku})`,
          );
        }
      }

      const subtotal = round2(priced.reduce((s, l) => s + l.lineTotal, 0));
      const grandTotal = round2(subtotal + deliveryFee);
      const orderNumber = await this.nextDocNumber(client, 'SABU');
      // Guests always get a track token; signed-in customers get one too so
      // confirmation + shareable tracking work without requiring login.
      const trackToken = randomBytes(24).toString('base64url');
      const trackHash = sha256(trackToken);

      const { rows: orders } = await client.query<{ id: string }>(
        `INSERT INTO sales.orders (
           order_number, customer_id, order_type, fulfillment_type, sales_channel,
           fulfillment_warehouse_id, region_id, status, payment_status, currency,
           subtotal, discount_total, tax_total, delivery_fee, grand_total,
           ship_recipient_name, ship_recipient_phone, ship_address_text, ship_location,
           customer_note, placed_at, idempotency_key,
           guest_track_token_hash, guest_phone_e164,
           preferred_contact_channel, requires_manual_contact, contact_consent_at
         ) VALUES (
           $1,$2,'retail',$3,'web',$4,$5,'pending_payment','unpaid','ETB',
           $6,0,0,$7,$8,$9,$10,$11,
           ST_SetSRID(ST_MakePoint($12,$13),4326)::geography,
           $14, now(), $15, $16, $17, $18, $19, $20
         ) RETURNING id`,
        [
          orderNumber,
          customerId,
          fulfillmentType,
          warehouseId,
          regionId,
          subtotal,
          deliveryFee,
          grandTotal,
          dto.recipientName,
          dto.recipientPhone,
          dto.addressText,
          dto.lng,
          dto.lat,
          dto.customerNote ?? null,
          dto.idempotencyKey ?? null,
          trackHash,
          dto.recipientPhone,
          preferredChannel,
          requiresManualContact,
          contactConsentAt,
        ],
      );
      const orderId = orders[0].id;

      let lineNo = 1;
      for (const line of priced) {
        const { rows: items } = await client.query<{ id: string }>(
          `INSERT INTO sales.order_items (
             order_id, line_no, variant_id, sku_snapshot, name_snapshot,
             quantity, unit_price, price_list_item_id, tax_rate, tax_amount, line_total
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9) RETURNING id`,
          [
            orderId,
            lineNo++,
            line.variant_id,
            line.sku,
            `${line.product_name}${line.variant_name ? ` — ${line.variant_name}` : ''}`,
            line.quantity,
            line.unit,
            line.priceListItemId,
            line.lineTotal,
          ],
        );
        await client.query(
          `INSERT INTO inventory.stock_reservations (
             warehouse_id, variant_id, order_item_id, quantity, status, expires_at
           ) VALUES ($1,$2,$3,$4,'active', now() + interval '30 minutes')`,
          [warehouseId, line.variant_id, items[0].id, line.quantity],
        );
      }

      await client.query(
        `INSERT INTO sales.order_status_history (order_id, from_status, to_status, reason, changed_by)
         VALUES ($1, NULL, 'pending_payment', $2, $3)`,
        [
          orderId,
          isGuest ? 'Guest checkout' : 'Checkout placed',
          opts.user?.id ?? null,
        ],
      );

      const { rows: methods } = await client.query<{
        id: string;
        code: string;
        display_name: string;
      }>(
        `SELECT id, code, display_name FROM payments.payment_methods WHERE id = $1 AND is_active`,
        [dto.paymentMethodId],
      );
      if (!methods[0]) throw new BadRequestException('Invalid payment method');
      const { rows: intents } = await client.query<{ id: string }>(
        `INSERT INTO payments.payment_intents (order_id, purpose, amount, currency, status)
         VALUES ($1, 'full', $2, 'ETB', 'pending') RETURNING id`,
        [orderId, grandTotal],
      );
      const paymentIntentId = intents[0].id;
      const paymentMethodCode = methods[0].code;
      const paymentMethodDisplayName = methods[0].display_name;
      const trackingUrl = `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(trackToken)}`;
      const itemsSnapshot = priced.map((l) => ({
        name: `${l.product_name}${l.variant_name ? ` — ${l.variant_name}` : ''}`,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        unitPrice: l.unit,
      }));

      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('order', $1, 'order.placed', $2::jsonb)`,
        [
          orderId,
          JSON.stringify({
            orderId,
            orderNumber,
            phone: dto.recipientPhone,
            recipientName: dto.recipientName,
            grandTotal,
            isGuest,
            preferredContactChannel: preferredChannel,
            requiresManualContact,
            trackingUrl,
            trackToken,
          }),
        ],
      );

      await client.query(
        `UPDATE sales.carts SET status = 'converted', updated_at = now() WHERE id = $1`,
        [cartId],
      );
      await client.query(`DELETE FROM sales.cart_items WHERE cart_id = $1`, [
        cartId,
      ]);

      await client.query('COMMIT');
      return {
        orderId,
        orderNumber,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        currency: 'ETB',
        subtotal,
        deliveryFee,
        grandTotal,
        paymentIntentId,
        paymentMethodCode,
        paymentMethodDisplayName,
        preferredContactChannel: preferredChannel,
        requiresManualContact,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        addressText: dto.addressText,
        fulfillmentType,
        estimatedDeliveryAt: null as string | null,
        trackingUrl,
        trackToken,
        items: itemsSnapshot,
        confirmationMessage: requiresManualContact
          ? manualConfirmMessage(orderNumber)
          : autoConfirmMessage(orderNumber),
        replayed: false,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      if ((err as { code?: string }).code === '23505' && dto.idempotencyKey) {
        const again = await this.findByIdempotency(dto.idempotencyKey);
        if (again) return again;
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async trackOrder(orderNumber: string, token: string, phone?: string) {
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      fulfillment_type: string;
      subtotal: string;
      delivery_fee: string;
      grand_total: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      preferred_contact_channel: string | null;
      requires_manual_contact: boolean;
      estimated_delivery_at: Date | null;
      placed_at: Date | null;
    }>(
      `SELECT id, order_number, status, payment_status, fulfillment_type,
              subtotal::text, delivery_fee::text, grand_total::text,
              ship_recipient_name, ship_recipient_phone, ship_address_text,
              preferred_contact_channel, requires_manual_contact,
              estimated_delivery_at, placed_at
       FROM sales.orders
       WHERE order_number = $1 AND guest_track_token_hash = $2`,
      [orderNumber, sha256(token)],
    );
    if (!rows[0]) throw new NotFoundException('Order not found');
    const order = rows[0];

    if (phone) {
      const normalized = phone.trim();
      const ok =
        order.ship_recipient_phone === normalized ||
        (await this.phoneMatchesOrder(order.id, normalized));
      if (!ok) {
        throw new UnauthorizedException('Phone does not match this order');
      }
    }

    const { rows: items } = await this.db.query<{
      name_snapshot: string;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT name_snapshot, quantity, unit_price::text, line_total::text
       FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
      [order.id],
    );

    const { rows: pay } = await this.db.query<{
      code: string | null;
      display_name: string | null;
    }>(
      `SELECT m.code, m.display_name
       FROM payments.payment_intents pi
       LEFT JOIN LATERAL (
         SELECT payment_method_id FROM payments.payment_transactions
         WHERE payment_intent_id = pi.id
         ORDER BY initiated_at DESC LIMIT 1
       ) t ON true
       LEFT JOIN payments.payment_methods m ON m.id = t.payment_method_id
       WHERE pi.order_id = $1
       ORDER BY pi.created_at DESC
       LIMIT 1`,
      [order.id],
    );

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      fulfillmentType: order.fulfillment_type,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      grandTotal: Number(order.grand_total),
      currency: 'ETB',
      recipientName: order.ship_recipient_name,
      recipientPhoneMasked: maskPhone(order.ship_recipient_phone),
      address: order.ship_address_text,
      preferredContactChannel: order.preferred_contact_channel,
      requiresManualContact: order.requires_manual_contact,
      estimatedDeliveryAt: order.estimated_delivery_at,
      paymentMethodCode: pay[0]?.code ?? null,
      paymentMethodDisplayName: pay[0]?.display_name ?? null,
      placedAt: order.placed_at,
      trackingUrl: `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(order.order_number)}&token=${encodeURIComponent(token)}`,
      items: items.map((i) => ({
        name: i.name_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
    };
  }

  /**
   * Recover a tracking token with order number + phone (rotates the token).
   */
  async recoverTrackByPhone(orderNumber: string, phone: string) {
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      throw new BadRequestException('Phone must be E.164');
    }
    const { rows } = await this.db.query<{
      id: string;
      ship_recipient_phone: string | null;
      guest_phone_e164: string | null;
    }>(
      `SELECT id, ship_recipient_phone, guest_phone_e164
       FROM sales.orders WHERE order_number = $1`,
      [orderNumber],
    );
    if (!rows[0]) throw new NotFoundException('Order not found');
    const order = rows[0];
    if (
      order.ship_recipient_phone !== phone &&
      order.guest_phone_e164 !== phone
    ) {
      throw new UnauthorizedException('Phone does not match this order');
    }

    const trackToken = randomBytes(24).toString('base64url');
    await this.db.query(
      `UPDATE sales.orders
       SET guest_track_token_hash = $2, updated_at = now()
       WHERE id = $1`,
      [order.id, sha256(trackToken)],
    );

    await this.db.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', $1, 'order.track_recovered', $2::jsonb)`,
      [
        order.id,
        JSON.stringify({
          orderId: order.id,
          orderNumber,
          phone,
          reason: 'phone_verification',
        }),
      ],
    );

    const tracked = await this.trackOrder(orderNumber, trackToken);
    return { ...tracked, trackToken };
  }

  async adminListOrders(opts?: {
    status?: string;
    paymentStatus?: string;
    q?: string;
    requiresManualContact?: boolean;
    limit?: number;
  }) {
    const limit = Math.min(opts?.limit ?? 100, 200);
    const params: unknown[] = [];
    const where = [`TRUE`];

    if (opts?.status) {
      params.push(opts.status);
      where.push(`o.status = $${params.length}`);
    }
    if (opts?.paymentStatus) {
      params.push(opts.paymentStatus);
      where.push(`o.payment_status = $${params.length}`);
    }
    if (opts?.requiresManualContact === true) {
      where.push(`o.requires_manual_contact = true`);
    }
    if (opts?.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(o.order_number ILIKE $${params.length} OR o.ship_recipient_name ILIKE $${params.length} OR o.ship_recipient_phone ILIKE $${params.length} OR o.guest_phone_e164 ILIKE $${params.length})`,
      );
    }

    params.push(limit);
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      fulfillment_type: string;
      grand_total: string;
      currency: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      preferred_contact_channel: string | null;
      requires_manual_contact: boolean;
      placed_at: Date | null;
      created_at: Date;
      is_guest: boolean | null;
      item_count: string;
      delivery_id: string | null;
      delivery_status: string | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.fulfillment_type,
              o.grand_total::text, o.currency,
              o.ship_recipient_name, o.ship_recipient_phone, o.ship_address_text,
              o.preferred_contact_channel, o.requires_manual_contact,
              o.placed_at, o.created_at, c.is_guest,
              (SELECT count(*)::text FROM sales.order_items oi WHERE oi.order_id = o.id) AS item_count,
              d.id AS delivery_id, d.status AS delivery_status
       FROM sales.orders o
       LEFT JOIN crm.customers c ON c.id = o.customer_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM delivery.deliveries
         WHERE order_id = o.id AND status NOT IN ('cancelled')
         ORDER BY created_at DESC LIMIT 1
       ) d ON true
       WHERE ${where.join(' AND ')}
       ORDER BY o.requires_manual_contact DESC, o.created_at DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      fulfillmentType: o.fulfillment_type,
      grandTotal: Number(o.grand_total),
      currency: o.currency,
      recipientName: o.ship_recipient_name,
      recipientPhone: o.ship_recipient_phone,
      address: o.ship_address_text,
      preferredContactChannel: o.preferred_contact_channel,
      requiresManualContact: o.requires_manual_contact,
      placedAt: o.placed_at,
      createdAt: o.created_at,
      isGuest: Boolean(o.is_guest),
      itemCount: Number(o.item_count),
      deliveryId: o.delivery_id,
      deliveryStatus: o.delivery_status,
    }));
  }

  async adminGetOrder(orderId: string) {
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      fulfillment_type: string;
      subtotal: string;
      delivery_fee: string;
      grand_total: string;
      currency: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      customer_note: string | null;
      placed_at: Date | null;
      lng: string | null;
      lat: string | null;
      is_guest: boolean | null;
      guest_phone_e164: string | null;
      preferred_contact_channel: string | null;
      requires_manual_contact: boolean;
      estimated_delivery_at: Date | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.fulfillment_type,
              o.subtotal::text, o.delivery_fee::text, o.grand_total::text, o.currency,
              o.ship_recipient_name, o.ship_recipient_phone, o.ship_address_text,
              o.customer_note, o.placed_at, o.guest_phone_e164,
              o.preferred_contact_channel, o.requires_manual_contact,
              o.estimated_delivery_at,
              ST_X(o.ship_location::geometry)::text AS lng,
              ST_Y(o.ship_location::geometry)::text AS lat,
              c.is_guest
       FROM sales.orders o
       LEFT JOIN crm.customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Order not found');

    const { rows: items } = await this.db.query<{
      line_no: number;
      name_snapshot: string;
      sku_snapshot: string | null;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT line_no, name_snapshot, sku_snapshot, quantity, unit_price::text, line_total::text
       FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
      [orderId],
    );

    const { rows: history } = await this.db.query<{
      from_status: string | null;
      to_status: string;
      reason: string | null;
      changed_at: Date;
    }>(
      `SELECT from_status, to_status, reason, changed_at
       FROM sales.order_status_history
       WHERE order_id = $1 ORDER BY changed_at`,
      [orderId],
    );

    const { rows: payments } = await this.db.query<{
      intent_id: string;
      intent_status: string;
      amount: string;
      tx_id: string | null;
      tx_status: string | null;
      method_code: string | null;
    }>(
      `SELECT pi.id AS intent_id, pi.status AS intent_status, pi.amount::text,
              t.id AS tx_id, t.status AS tx_status, m.code AS method_code
       FROM payments.payment_intents pi
       LEFT JOIN LATERAL (
         SELECT id, status, payment_method_id FROM payments.payment_transactions
         WHERE payment_intent_id = pi.id
         ORDER BY initiated_at DESC LIMIT 1
       ) t ON true
       LEFT JOIN payments.payment_methods m ON m.id = t.payment_method_id
       WHERE pi.order_id = $1
       ORDER BY pi.created_at DESC`,
      [orderId],
    );

    const { rows: deliveries } = await this.db.query<{
      id: string;
      delivery_number: string;
      status: string;
    }>(
      `SELECT id, delivery_number, status FROM delivery.deliveries
       WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId],
    );

    const { rows: notifications } = await this.db.query<{
      id: string;
      event_code: string;
      channel: string;
      destination_masked: string;
      status: string;
      message_preview: string | null;
      last_error: string | null;
      attempt_count: number;
      created_at: Date;
      sent_at: Date | null;
    }>(
      `SELECT id, event_code, channel, destination_masked, status,
              message_preview, last_error, attempt_count, created_at, sent_at
       FROM notify.order_notification_logs
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [orderId],
    );

    const { rows: contactAttempts } = await this.db.query<{
      id: string;
      channel: string;
      outcome: string;
      notes: string | null;
      attempted_at: Date;
      attempted_by: string | null;
      full_name: string | null;
    }>(
      `SELECT a.id, a.channel, a.outcome, a.notes, a.attempted_at, a.attempted_by,
              u.full_name
       FROM notify.customer_contact_attempts a
       LEFT JOIN iam.users u ON u.id = a.attempted_by
       WHERE a.order_id = $1
       ORDER BY a.attempted_at DESC
       LIMIT 50`,
      [orderId],
    );

    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      fulfillmentType: order.fulfillment_type,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      grandTotal: Number(order.grand_total),
      currency: order.currency,
      shipping: {
        name: order.ship_recipient_name,
        phone: order.ship_recipient_phone,
        address: order.ship_address_text,
        lng: order.lng != null ? Number(order.lng) : null,
        lat: order.lat != null ? Number(order.lat) : null,
      },
      preferredContactChannel: order.preferred_contact_channel,
      requiresManualContact: order.requires_manual_contact,
      estimatedDeliveryAt: order.estimated_delivery_at,
      customerNote: order.customer_note,
      placedAt: order.placed_at,
      isGuest: Boolean(order.is_guest),
      guestPhone: order.guest_phone_e164,
      items: items.map((i) => ({
        lineNo: i.line_no,
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
      history: history.map((h) => ({
        fromStatus: h.from_status,
        toStatus: h.to_status,
        reason: h.reason,
        changedAt: h.changed_at,
      })),
      payments: payments.map((p) => ({
        intentId: p.intent_id,
        intentStatus: p.intent_status,
        amount: Number(p.amount),
        transactionId: p.tx_id,
        transactionStatus: p.tx_status,
        methodCode: p.method_code,
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        deliveryNumber: d.delivery_number,
        status: d.status,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        eventCode: n.event_code,
        channel: n.channel,
        destinationMasked: n.destination_masked,
        status: n.status,
        messagePreview: n.message_preview,
        lastError: n.last_error,
        attemptCount: n.attempt_count,
        createdAt: n.created_at,
        sentAt: n.sent_at,
      })),
      contactAttempts: contactAttempts.map((a) => ({
        id: a.id,
        channel: a.channel,
        outcome: a.outcome,
        notes: a.notes,
        attemptedAt: a.attempted_at,
        attemptedByName: a.full_name,
      })),
    };
  }

  async adminRecordContactAttempt(
    user: AuthUser,
    orderId: string,
    body: {
      channel: string;
      outcome: string;
      notes?: string;
      clearManualFlag?: boolean;
    },
  ) {
    const allowedChannels = [
      'phone',
      'sms',
      'whatsapp',
      'telegram',
      'viber',
      'email',
      'other',
    ];
    const allowedOutcomes = [
      'reached',
      'no_answer',
      'voicemail',
      'wrong_number',
      'callback_requested',
      'declined',
      'other',
    ];
    if (!allowedChannels.includes(body.channel)) {
      throw new BadRequestException('Invalid channel');
    }
    if (!allowedOutcomes.includes(body.outcome)) {
      throw new BadRequestException('Invalid outcome');
    }

    const { rowCount } = await this.db.query(
      `SELECT 1 FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    if (!rowCount) throw new NotFoundException('Order not found');

    await this.db.query(
      `INSERT INTO notify.customer_contact_attempts
         (order_id, attempted_by, channel, outcome, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, user.id, body.channel, body.outcome, body.notes ?? null],
    );

    if (body.clearManualFlag) {
      await this.db.query(
        `UPDATE sales.orders
         SET requires_manual_contact = false, updated_at = now()
         WHERE id = $1`,
        [orderId],
      );
    }

    return this.adminGetOrder(orderId);
  }

  async adminResendNotification(
    user: AuthUser,
    orderId: string,
    eventCode = 'order.placed',
  ) {
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      ship_recipient_phone: string | null;
      ship_recipient_name: string | null;
      preferred_contact_channel: string | null;
      requires_manual_contact: boolean;
      grand_total: string;
    }>(
      `SELECT id, order_number, ship_recipient_phone, ship_recipient_name,
              preferred_contact_channel, requires_manual_contact, grand_total::text
       FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    if (!rows[0]) throw new NotFoundException('Order not found');
    const o = rows[0];

    // Rotate track token so the resend includes a usable link
    const trackToken = randomBytes(24).toString('base64url');
    await this.db.query(
      `UPDATE sales.orders
       SET guest_track_token_hash = $2, updated_at = now()
       WHERE id = $1`,
      [orderId, sha256(trackToken)],
    );
    const trackingUrl = `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(o.order_number)}&token=${encodeURIComponent(trackToken)}`;

    await this.db.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', $1, $2, $3::jsonb)`,
      [
        orderId,
        eventCode,
        JSON.stringify({
          orderId,
          orderNumber: o.order_number,
          phone: o.ship_recipient_phone,
          recipientName: o.ship_recipient_name,
          grandTotal: Number(o.grand_total),
          preferredContactChannel: o.preferred_contact_channel,
          requiresManualContact: o.requires_manual_contact,
          trackingUrl,
          trackToken,
          resentBy: user.id,
          resent: true,
        }),
      ],
    );

    return {
      ok: true,
      eventCode,
      trackingUrl,
      message: 'Notification re-queued',
    };
  }

  async adminUpdateOrderStatus(
    user: AuthUser,
    orderId: string,
    status: string,
    reason?: string,
  ) {
    const allowed = [
      'confirmed',
      'processing',
      'ready_for_dispatch',
      'dispatched',
      'delivered',
      'completed',
      'delivery_failed',
      'cancelled',
    ];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Invalid status ${status}`);
    }
    const { rows } = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    if (!rows[0]) throw new NotFoundException('Order not found');
    const from = rows[0].status;
    await this.db.query(
      `UPDATE sales.orders SET status = $2, updated_at = now() WHERE id = $1`,
      [orderId, status],
    );
    await this.db.query(
      `INSERT INTO sales.order_status_history (order_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [orderId, from, status, reason ?? 'Admin update', user.id],
    );
    return this.adminGetOrder(orderId);
  }

  async listMyOrders(user: AuthUser) {
    const customerId = await this.requireCustomerId(user.id);
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      grand_total: string;
      currency: string;
      placed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, order_number, status, payment_status, grand_total::text, currency, placed_at, created_at
       FROM sales.orders WHERE customer_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [customerId],
    );
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      grandTotal: Number(o.grand_total),
      currency: o.currency,
      placedAt: o.placed_at,
      createdAt: o.created_at,
    }));
  }

  async getOrder(user: AuthUser, orderId: string) {
    const customerId = await this.requireCustomerId(user.id);
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      subtotal: string;
      delivery_fee: string;
      grand_total: string;
      currency: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      placed_at: Date | null;
    }>(
      `SELECT id, order_number, status, payment_status,
              subtotal::text, delivery_fee::text, grand_total::text, currency,
              ship_recipient_name, ship_recipient_phone, ship_address_text, placed_at
       FROM sales.orders WHERE id = $1 AND customer_id = $2`,
      [orderId, customerId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Order not found');
    const { rows: items } = await this.db.query<{
      line_no: number;
      name_snapshot: string;
      sku_snapshot: string | null;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT line_no, name_snapshot, sku_snapshot, quantity, unit_price::text, line_total::text
       FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
      [orderId],
    );
    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      grandTotal: Number(order.grand_total),
      currency: order.currency,
      shipping: {
        name: order.ship_recipient_name,
        phone: order.ship_recipient_phone,
        address: order.ship_address_text,
      },
      placedAt: order.placed_at,
      items: items.map((i) => ({
        lineNo: i.line_no,
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
    };
  }

  // ——— private helpers ———

  private async findByIdempotency(key: string) {
    const { rows } = await this.db.query<{
      id: string;
      order_number: string;
      status: string;
      grand_total: string;
      payment_status: string;
      subtotal: string;
      delivery_fee: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      fulfillment_type: string;
      preferred_contact_channel: string | null;
      requires_manual_contact: boolean;
    }>(
      `SELECT id, order_number, status, grand_total::text, payment_status,
              subtotal::text, delivery_fee::text,
              ship_recipient_name, ship_recipient_phone, ship_address_text,
              fulfillment_type, preferred_contact_channel, requires_manual_contact
       FROM sales.orders WHERE idempotency_key = $1`,
      [key],
    );
    if (!rows[0]) return null;
    const o = rows[0];

    const { rows: intents } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments.payment_intents
       WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [o.id],
    );
    const { rows: methods } = await this.db.query<{
      code: string | null;
      display_name: string | null;
    }>(
      `SELECT m.code, m.display_name
       FROM payments.payment_intents pi
       LEFT JOIN LATERAL (
         SELECT payment_method_id FROM payments.payment_transactions
         WHERE payment_intent_id = pi.id
         ORDER BY initiated_at DESC LIMIT 1
       ) t ON true
       LEFT JOIN payments.payment_methods m ON m.id = COALESCE(
         t.payment_method_id,
         (SELECT id FROM payments.payment_methods WHERE is_active ORDER BY sort_order LIMIT 1)
       )
       WHERE pi.order_id = $1
       ORDER BY pi.created_at DESC LIMIT 1`,
      [o.id],
    );
    const { rows: items } = await this.db.query<{
      name_snapshot: string;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT name_snapshot, quantity, unit_price::text, line_total::text
       FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
      [o.id],
    );

    // Rotate track token so confirmation page still works on retry
    const trackToken = randomBytes(24).toString('base64url');
    await this.db.query(
      `UPDATE sales.orders SET guest_track_token_hash = $2, updated_at = now()
       WHERE id = $1`,
      [o.id, sha256(trackToken)],
    );
    const trackingUrl = `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(o.order_number)}&token=${encodeURIComponent(trackToken)}`;

    return {
      orderId: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      currency: 'ETB',
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.delivery_fee),
      grandTotal: Number(o.grand_total),
      paymentIntentId: intents[0]?.id ?? null,
      paymentMethodCode: methods[0]?.code ?? null,
      paymentMethodDisplayName: methods[0]?.display_name ?? null,
      preferredContactChannel: o.preferred_contact_channel,
      requiresManualContact: o.requires_manual_contact,
      recipientName: o.ship_recipient_name,
      recipientPhone: o.ship_recipient_phone,
      addressText: o.ship_address_text,
      fulfillmentType: o.fulfillment_type,
      estimatedDeliveryAt: null as string | null,
      trackingUrl,
      trackToken,
      items: items.map((i) => ({
        name: i.name_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
      confirmationMessage: o.requires_manual_contact
        ? manualConfirmMessage(o.order_number)
        : autoConfirmMessage(o.order_number),
      replayed: true,
    };
  }

  private async upsertGuestCustomer(
    phone: string,
    firstName: string,
    lastName: string,
    preferredChannel?: string,
  ): Promise<string> {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM crm.customers
       WHERE is_guest = true AND phone_e164 = $1`,
      [phone],
    );
    if (existing.rows[0]) {
      await this.db.query(
        `UPDATE crm.customers
         SET first_name = $2, last_name = $3,
             preferred_contact_channel = COALESCE($4, preferred_contact_channel),
             updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, firstName, lastName, preferredChannel ?? null],
      );
      return existing.rows[0].id;
    }
    const code = await this.nextCustomerCode();
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO crm.customers (
         user_id, customer_type, customer_code, is_guest,
         first_name, last_name, phone_e164, preferred_contact_channel
       ) VALUES (NULL, 'retail', $1, true, $2, $3, $4, $5)
       RETURNING id`,
      [code, firstName, lastName, phone, preferredChannel ?? null],
    );
    return rows[0].id;
  }

  private async phoneMatchesOrder(orderId: string, phone: string) {
    const { rows } = await this.db.query<{ ok: boolean }>(
      `SELECT (guest_phone_e164 = $2 OR ship_recipient_phone = $2) AS ok
       FROM sales.orders WHERE id = $1`,
      [orderId, phone],
    );
    return Boolean(rows[0]?.ok);
  }

  private webBase() {
    return (
      process.env.PUBLIC_WEB_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
    );
  }

  private async nextCustomerCode() {
    const client = await this.db.getPool().connect();
    try {
      return await this.nextDocNumber(client, 'CUS');
    } finally {
      client.release();
    }
  }

  private async addItemToCart(cartId: string, dto: AddCartItemDto) {
    await this.assertVariantSellable(dto.variantId);
    await this.db.query(
      `INSERT INTO sales.cart_items (cart_id, variant_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, variant_id)
       DO UPDATE SET
         quantity = LEAST(
           500,
           CASE
             WHEN $4::boolean THEN EXCLUDED.quantity
             ELSE sales.cart_items.quantity + EXCLUDED.quantity
           END
         ),
         updated_at = now()`,
      [cartId, dto.variantId, dto.quantity, dto.replace === true],
    );
    await this.db.query(`UPDATE sales.carts SET updated_at = now() WHERE id = $1`, [
      cartId,
    ]);
    return this.loadCartView(cartId);
  }

  private async updateCartItem(cartId: string, itemId: string, quantity: number) {
    const { rowCount } = await this.db.query(
      `UPDATE sales.cart_items SET quantity = $1, updated_at = now()
       WHERE id = $2 AND cart_id = $3`,
      [quantity, itemId, cartId],
    );
    if (!rowCount) throw new NotFoundException('Cart item not found');
    return this.loadCartView(cartId);
  }

  private async removeCartItem(cartId: string, itemId: string) {
    const { rowCount } = await this.db.query(
      `DELETE FROM sales.cart_items WHERE id = $1 AND cart_id = $2`,
      [itemId, cartId],
    );
    if (!rowCount) throw new NotFoundException('Cart item not found');
    return this.loadCartView(cartId);
  }

  private async requireCustomerId(userId: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM crm.customers WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]) throw new BadRequestException('Customer profile required');
    return rows[0].id;
  }

  private async getOrCreateCustomerCart(customerId: string): Promise<CartRow> {
    const existing = await this.db.query<CartRow>(
      `SELECT id, customer_id, currency, status FROM sales.carts
       WHERE customer_id = $1 AND status = 'active'`,
      [customerId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const created = await this.db.query<CartRow>(
      `INSERT INTO sales.carts (customer_id, currency, status)
       VALUES ($1, 'ETB', 'active')
       RETURNING id, customer_id, currency, status`,
      [customerId],
    );
    return created.rows[0];
  }

  private async getOrCreateGuestCart(guestToken: string): Promise<CartRow> {
    if (!guestToken || guestToken.length < 16) {
      throw new BadRequestException('Invalid guest token');
    }
    const hash = sha256(guestToken);
    const existing = await this.db.query<CartRow>(
      `SELECT id, customer_id, currency, status FROM sales.carts
       WHERE anonymous_token_hash = $1 AND status = 'active'`,
      [hash],
    );
    if (existing.rows[0]) return existing.rows[0];
    const created = await this.db.query<CartRow>(
      `INSERT INTO sales.carts (customer_id, anonymous_token_hash, currency, status, expires_at)
       VALUES (NULL, $1, 'ETB', 'active', now() + interval '14 days')
       RETURNING id, customer_id, currency, status`,
      [hash],
    );
    return created.rows[0];
  }

  private async assertVariantSellable(variantId: string) {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT pv.id FROM catalog.product_variants pv
       JOIN catalog.products p ON p.id = pv.product_id
       WHERE pv.id = $1 AND pv.is_active AND pv.deleted_at IS NULL
         AND p.status = 'active' AND p.deleted_at IS NULL`,
      [variantId],
    );
    if (!rows[0]) throw new NotFoundException('Variant not found');
  }

  private async loadCartView(cartId: string) {
    const { rows } = await this.db.query<{
      item_id: string;
      variant_id: string;
      quantity: number;
      sku: string;
      product_name: string;
      product_slug: string;
      variant_name: string | null;
      bulk_purchasing_enabled: boolean;
      available: string | null;
    }>(
      `SELECT ci.id AS item_id, ci.variant_id, ci.quantity, pv.sku,
              p.name AS product_name, p.slug AS product_slug, pv.variant_name,
              p.bulk_purchasing_enabled,
              (sb.qty_on_hand - sb.qty_reserved)::text AS available
       FROM sales.cart_items ci
       JOIN catalog.product_variants pv ON pv.id = ci.variant_id
       JOIN catalog.products p ON p.id = pv.product_id
       LEFT JOIN inventory.warehouses w ON w.code = 'ADD-MAIN'
       LEFT JOIN inventory.stock_balances sb
         ON sb.warehouse_id = w.id AND sb.variant_id = pv.id
       WHERE ci.cart_id = $1
       ORDER BY ci.added_at`,
      [cartId],
    );

    const items = [];
    for (const r of rows) {
      const listCode = r.bulk_purchasing_enabled ? 'WHOLESALE-ETB' : 'RETAIL-ETB';
      // Prefer wholesale tier when qty qualifies; resolver falls back to retail
      let unitPrice: number | null = null;
      let compareAtPrice: number | null = null;
      let currency = 'ETB';
      try {
        const price = await this.pricing.resolveUnitPrice(
          r.variant_id,
          r.quantity,
          r.bulk_purchasing_enabled && r.quantity >= 10
            ? 'WHOLESALE-ETB'
            : 'RETAIL-ETB',
        );
        unitPrice = price.unitPrice;
        compareAtPrice = price.compareAtPrice;
        currency = price.currency;
        void listCode;
      } catch {
        unitPrice = null;
      }
      items.push({
        id: r.item_id,
        variantId: r.variant_id,
        quantity: r.quantity,
        sku: r.sku,
        productName: r.product_name,
        productSlug: r.product_slug,
        variantName: r.variant_name,
        unitPrice,
        compareAtPrice,
        lineTotal: unitPrice != null ? round2(unitPrice * r.quantity) : null,
        currency,
        available: r.available != null ? Number(r.available) : null,
        bulkEnabled: r.bulk_purchasing_enabled,
      });
    }

    return {
      id: cartId,
      currency: 'ETB',
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      subtotal: round2(items.reduce((s, i) => s + (i.lineTotal ?? 0), 0)),
      items,
    };
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

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest();
}

function maskPhone(phone: string | null) {
  if (!phone) return null;
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function autoConfirmMessage(orderNumber: string) {
  return `Thank you for shopping with Sabu Online Shopping!\n\nYour order #${orderNumber} has been received successfully.\n\nWe are currently processing your order. You can use your order number and secure tracking link to check its status.\n\nWe appreciate your business and look forward to serving you!`;
}

function manualConfirmMessage(orderNumber: string) {
  return `Thank you for shopping with Sabu Online Shopping!\n\nYour order #${orderNumber} has been received successfully.\n\nOur administration team will contact you using the phone number you provided once your order has been reviewed and processed.\n\nPlease keep your phone available for further updates.`;
}

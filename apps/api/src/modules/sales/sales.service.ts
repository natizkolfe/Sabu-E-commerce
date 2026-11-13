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
import { DeliveryService } from '../delivery/delivery.service';
import { AuthUser } from '../iam/auth.types';
import { NotifyService } from '../notify/notify.service';
import { WhatsAppService } from '../notify/whatsapp.service';
import { PricingService } from '../pricing/pricing.service';
import {
  ETHIOPIAN_PHONE_ERROR,
  normalizeEthiopianPhone,
} from '../../common/phone';
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
    private readonly delivery: DeliveryService,
    private readonly notify: NotifyService,
    private readonly whatsapp: WhatsAppService,
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
    const listCode = dto.priceListCode ?? 'RETAIL-ETB';
    const preferredChannel = dto.preferredContactChannel;
    if (!preferredChannel) {
      throw new BadRequestException('preferredContactChannel is required');
    }
    const normalizedPhone = normalizeEthiopianPhone(dto.recipientPhone);
    if (!normalizedPhone) {
      throw new BadRequestException(ETHIOPIAN_PHONE_ERROR);
    }
    dto.recipientPhone = normalizedPhone;
    const requiresManualContact =
      preferredChannel === 'phone' || preferredChannel === 'sms';
    const contactConsentAt =
      dto.contactConsent === false ? null : new Date().toISOString();

    if (fulfillmentType === 'local_delivery') {
      if (!dto.locationConfirmed) {
        throw new BadRequestException(
          'Confirm your delivery location on the map before placing the order',
        );
      }
      if (
        dto.lng == null ||
        dto.lat == null ||
        Number.isNaN(dto.lng) ||
        Number.isNaN(dto.lat)
      ) {
        throw new BadRequestException('Delivery map coordinates are required');
      }
    }

    if (!dto.amountAcknowledged) {
      throw new BadRequestException(
        'Acknowledge the final payable amount before placing the order',
      );
    }

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
        vendor_id: string | null;
        bulk_purchasing_enabled: boolean;
        returns_allowed: boolean;
        return_window_days: number | null;
        return_conditions: string | null;
        return_instructions: string | null;
        return_policy_description: string | null;
      }>(
        `SELECT ci.id AS item_id, ci.variant_id, ci.quantity, pv.sku,
                p.name AS product_name, pv.variant_name, p.vendor_id,
                p.bulk_purchasing_enabled,
                p.returns_allowed, p.return_window_days, p.return_conditions,
                p.return_instructions, p.return_policy_description
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

      let deliveryFee = 0;
      let deliveryDistanceKm: number | null = null;
      let deliveryFeeRate: number | null = null;
      let deliveryRouteSource: string | null = null;
      let deliveryPricingSnapshot: Record<string, unknown> = {};
      let deliveryServiceType: 'standard' | 'express' | null = null;
      let deliveryEtaMinutes: number | null = null;
      let deliveryEtaWindowText: string | null = null;
      let deliveryEtaDisclaimer: string | null = null;

      if (fulfillmentType === 'local_delivery') {
        const serviceType =
          dto.deliveryServiceType === 'express' ? 'express' : 'standard';
        const quote = await this.delivery.quoteDelivery({
          lat: dto.lat,
          lng: dto.lng,
          subtotal,
          serviceType,
        });
        if (quote.pendingAdmin || quote.deliveryFee == null) {
          throw new BadRequestException(
            'Delivery quote pending administrator confirmation — confirm your map pin',
          );
        }
        const fee = quote.deliveryFee;
        const dist = quote.distanceKm;
        const rate = quote.feePerKm;
        const route = quote.routeSource;
        deliveryFee = fee;
        deliveryDistanceKm = dist;
        deliveryFeeRate = rate;
        deliveryRouteSource = route;
        deliveryServiceType = serviceType;
        deliveryEtaMinutes =
          'etaMinutes' in quote && quote.etaMinutes != null
            ? Number(quote.etaMinutes)
            : null;
        deliveryEtaWindowText =
          'etaWindowText' in quote && typeof quote.etaWindowText === 'string'
            ? quote.etaWindowText
            : null;
        deliveryEtaDisclaimer =
          'etaDisclaimer' in quote && typeof quote.etaDisclaimer === 'string'
            ? quote.etaDisclaimer
            : null;
        deliveryPricingSnapshot =
          'snapshot' in quote && quote.snapshot
            ? quote.snapshot
            : {
                distanceKm: dist,
                feePerKm: rate,
                deliveryFee: fee,
                routeSource: route,
                serviceType,
              };
      }

      const grandTotal = round2(subtotal + deliveryFee);
      const orderNumber = await this.nextDocNumber(client, 'SABU');
      // Guests always get a track token; signed-in customers get one too so
      // confirmation + shareable tracking work without requiring login.
      const trackToken = randomBytes(24).toString('base64url');
      const trackHash = sha256(trackToken);

      const locationType =
        dto.locationType ??
        (dto.landmarkName ? 'landmark_nearby' : 'exact');
      const locationSource = dto.locationSource ?? 'manual_pin';
      const deliveryInstructions =
        dto.deliveryInstructions?.trim() || dto.customerNote || null;
      const formattedAddress =
        dto.formattedAddress?.trim() || dto.addressText;

      const { rows: orders } = await client.query<{ id: string }>(
        `INSERT INTO sales.orders (
           order_number, customer_id, order_type, fulfillment_type, sales_channel,
           fulfillment_warehouse_id, region_id, status, payment_status, currency,
           subtotal, discount_total, tax_total, delivery_fee, grand_total,
           ship_recipient_name, ship_recipient_phone, ship_address_text, ship_location,
           customer_note, placed_at, idempotency_key,
           guest_track_token_hash, guest_phone_e164,
           preferred_contact_channel, requires_manual_contact, contact_consent_at,
           landmark_name, landmark_place_id, landmark_location,
           formatted_address, delivery_instructions, location_type, location_source,
           location_confirmed_at, landmark_lng, landmark_lat,
           delivery_distance_km, delivery_fee_rate, delivery_route_source,
           delivery_pricing_snapshot, delivery_service_type,
           delivery_eta_minutes, delivery_eta_window_text, delivery_eta_disclaimer
         ) VALUES (
           $1,$2,'retail',$3,'web',$4,$5,'pending_payment','pending_verification','ETB',
           $6,0,0,$7,$8,$9,$10,$11,
           ST_SetSRID(ST_MakePoint($12,$13),4326)::geography,
           $14, now(), $15, $16, $17, $18, $19, $20,
           $21, $22,
           CASE WHEN $23::float8 IS NOT NULL AND $24::float8 IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint($23,$24),4326)::geography
             ELSE NULL END,
           $25, $26, $27, $28,
           CASE WHEN $29::boolean THEN now() ELSE NULL END,
           $23, $24,
           $30, $31, $32, $33::jsonb, $34, $35, $36, $37
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
          dto.landmarkName ?? null,
          dto.landmarkPlaceId ?? null,
          dto.landmarkLng ?? null,
          dto.landmarkLat ?? null,
          formattedAddress,
          deliveryInstructions,
          locationType,
          locationSource,
          dto.locationConfirmed === true,
          deliveryDistanceKm,
          deliveryFeeRate,
          deliveryRouteSource,
          JSON.stringify(deliveryPricingSnapshot),
          deliveryServiceType,
          deliveryEtaMinutes,
          deliveryEtaWindowText,
          deliveryEtaDisclaimer,
        ],
      );
      const orderId = orders[0].id;

      let lineNo = 1;
      for (const line of priced) {
        const returnsAllowed = line.returns_allowed !== false;
        const returnLabel = returnsAllowed
          ? `Returns within ${line.return_window_days ?? 7} day(s)`
          : 'No Returns Available for This Item.';
        const { rows: items } = await client.query<{ id: string }>(
          `INSERT INTO sales.order_items (
             order_id, line_no, variant_id, sku_snapshot, name_snapshot,
             quantity, unit_price, price_list_item_id, tax_rate, tax_amount, line_total,
             vendor_id,
             returns_allowed_snapshot, return_window_days_snapshot,
             return_conditions_snapshot, return_instructions_snapshot,
             return_policy_description_snapshot, return_policy_label_snapshot
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING id`,
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
            line.vendor_id ?? null,
            returnsAllowed,
            returnsAllowed ? (line.return_window_days ?? 7) : null,
            line.return_conditions ?? null,
            line.return_instructions ?? null,
            line.return_policy_description ?? null,
            returnLabel,
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
      const paymentMethodCode = methods[0].code;
      const paymentMethodDisplayName = methods[0].display_name;

      const manualCodes = new Set([
        'telebirr_manual',
        'cbe_manual',
        'other_bank_manual',
      ]);
      const isManualPay = manualCodes.has(paymentMethodCode);
      let paymentTxnId: string | null = null;
      let companyBankAccountId: string | null =
        dto.companyBankAccountId ?? null;
      let destinationLabel: string | null = null;
      let destinationValue: string | null = null;

      if (isManualPay) {
        const { rows: tbSettings } = await client.query<{
          txn_format_regex: string;
          merchant_account: string;
          display_name: string;
        }>(
          `SELECT txn_format_regex, merchant_account, display_name
           FROM payments.telebirr_merchant_settings WHERE id = 1`,
        );
        const regex =
          tbSettings[0]?.txn_format_regex ?? '^[A-Za-z0-9\\-]{6,40}$';
        paymentTxnId = dto.telebirrTxnId?.trim() ?? '';
        if (!paymentTxnId) {
          throw new BadRequestException(
            'Payment transaction reference ID is required',
          );
        }
        let ok = false;
        try {
          ok = new RegExp(regex).test(paymentTxnId);
        } catch {
          ok = /^[A-Za-z0-9-]{6,40}$/.test(paymentTxnId);
        }
        if (!ok) {
          throw new BadRequestException(
            'Payment transaction reference format is invalid',
          );
        }

        if (paymentMethodCode === 'telebirr_manual') {
          destinationLabel = tbSettings[0]?.display_name ?? 'Telebirr';
          destinationValue = tbSettings[0]?.merchant_account ?? null;
        } else {
          if (paymentMethodCode === 'cbe_manual' && !companyBankAccountId) {
            const { rows: cbe } = await client.query<{ id: string }>(
              `SELECT id FROM payments.company_bank_accounts
               WHERE is_active AND (code = 'cbe' OR is_featured)
               ORDER BY sort_order LIMIT 1`,
            );
            companyBankAccountId = cbe[0]?.id ?? null;
          }
          if (!companyBankAccountId) {
            throw new BadRequestException(
              'Please select a bank account for payment',
            );
          }
          const { rows: banks } = await client.query<{
            id: string;
            bank_name: string;
            account_number: string;
            account_name: string;
          }>(
            `SELECT id, bank_name, account_number, account_name
             FROM payments.company_bank_accounts
             WHERE id = $1 AND is_active`,
            [companyBankAccountId],
          );
          if (!banks[0]) {
            throw new BadRequestException('Invalid bank account selected');
          }
          destinationLabel = `${banks[0].bank_name} — ${banks[0].account_name}`;
          destinationValue = banks[0].account_number;
        }

        const { rows: dupes } = await client.query<{ id: string }>(
          `SELECT t.id FROM payments.payment_transactions t
           WHERE t.provider_reference IS NOT NULL
             AND lower(t.provider_reference) = lower($1)
             AND t.status IN ('pending','succeeded')
           LIMIT 1`,
          [paymentTxnId],
        );
        if (dupes[0]) {
          throw new ConflictException(
            'This payment transaction reference was already submitted',
          );
        }
      }

      const { rows: intents } = await client.query<{ id: string }>(
        `INSERT INTO payments.payment_intents (order_id, purpose, amount, currency, status)
         VALUES ($1, 'full', $2, 'ETB', $3) RETURNING id`,
        [orderId, grandTotal, isManualPay ? 'processing' : 'pending'],
      );
      const paymentIntentId = intents[0].id;

      if (isManualPay && paymentTxnId) {
        const merchantRef = `${paymentMethodCode === 'telebirr_manual' ? 'TB' : 'BK'}-${orderNumber}-${randomBytes(3).toString('hex')}`;
        const { rows: txs } = await client.query<{ id: string }>(
          `INSERT INTO payments.payment_transactions (
             payment_intent_id, payment_method_id, merchant_reference,
             provider_reference, idempotency_key, amount, currency, status,
             customer_reference, company_bank_account_id,
             payment_destination_label, payment_destination_value
           ) VALUES ($1,$2,$3,$4,$5,$6,'ETB','pending',$4,$7,$8,$9)
           RETURNING id`,
          [
            paymentIntentId,
            methods[0].id,
            merchantRef,
            paymentTxnId,
            randomBytes(16).toString('hex'),
            grandTotal,
            companyBankAccountId,
            destinationLabel,
            destinationValue,
          ],
        );
        await client.query(
          `INSERT INTO payments.payment_verification_logs
             (transaction_id, order_id, action, notes, actor_user_id)
           VALUES ($1,$2,'submitted',$3,NULL)`,
          [
            txs[0].id,
            orderId,
            `Customer submitted ${paymentMethodDisplayName} ref ${paymentTxnId}`,
          ],
        );
      }
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

      let whatsappDeepLink: string | null = null;
      if (preferredChannel === 'whatsapp' && !requiresManualContact) {
        const waText = this.notify.buildOrderWhatsAppMessage({
          eventType: 'order.placed',
          orderNumber,
          trackingUrl,
          recipientName: dto.recipientName,
          grandTotal,
        });
        whatsappDeepLink = this.whatsapp.buildWaMeLink(
          dto.recipientPhone,
          waText,
        );
      }

      return {
        orderId,
        orderNumber,
        status: 'pending_payment',
        paymentStatus: isManualPay ? 'pending_verification' : 'unpaid',
        currency: 'ETB',
        subtotal,
        deliveryFee,
        deliveryDistanceKm,
        deliveryFeeRate,
        deliveryRouteSource,
        grandTotal,
        paymentIntentId,
        paymentMethodCode,
        paymentMethodDisplayName,
        telebirrTxnId: paymentTxnId,
        whatsappDeepLink,
        preferredContactChannel: preferredChannel,
        requiresManualContact,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        addressText: dto.addressText,
        fulfillmentType,
        estimatedDeliveryAt: null as string | null,
        deliveryLocation: {
          lng: dto.lng,
          lat: dto.lat,
          landmarkName: dto.landmarkName ?? null,
          landmarkPlaceId: dto.landmarkPlaceId ?? null,
          landmarkLng: dto.landmarkLng ?? null,
          landmarkLat: dto.landmarkLat ?? null,
          formattedAddress,
          deliveryInstructions,
          locationType,
          locationSource,
          googleMapsUrl: googleMapsNavUrl(dto.lat, dto.lng),
        },
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
      delivery_service_type: string | null;
      delivery_eta_minutes: number | null;
      delivery_eta_window_text: string | null;
      delivery_eta_disclaimer: string | null;
      delivery_distance_km: string | null;
    }>(
      `SELECT id, order_number, status, payment_status, fulfillment_type,
              subtotal::text, delivery_fee::text, grand_total::text,
              ship_recipient_name, ship_recipient_phone, ship_address_text,
              preferred_contact_channel, requires_manual_contact,
              estimated_delivery_at, placed_at,
              delivery_service_type, delivery_eta_minutes,
              delivery_eta_window_text, delivery_eta_disclaimer,
              delivery_distance_km::text
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
      returns_allowed_snapshot: boolean | null;
      return_window_days_snapshot: number | null;
      return_policy_label_snapshot: string | null;
      return_policy_description_snapshot: string | null;
    }>(
      `SELECT name_snapshot, quantity, unit_price::text, line_total::text,
              returns_allowed_snapshot, return_window_days_snapshot,
              return_policy_label_snapshot, return_policy_description_snapshot
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
      deliveryServiceType: order.delivery_service_type,
      deliveryEtaMinutes: order.delivery_eta_minutes,
      deliveryEtaWindowText: order.delivery_eta_window_text,
      deliveryEtaDisclaimer:
        order.delivery_eta_disclaimer ??
        'Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays.',
      deliveryDistanceKm:
        order.delivery_distance_km != null
          ? Number(order.delivery_distance_km)
          : null,
      etaIsEstimate: true,
      paymentMethodCode: pay[0]?.code ?? null,
      paymentMethodDisplayName: pay[0]?.display_name ?? null,
      placedAt: order.placed_at,
      trackingUrl: `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(order.order_number)}&token=${encodeURIComponent(token)}`,
      items: items.map((i) => ({
        name: i.name_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
        returnsAllowed: i.returns_allowed_snapshot,
        returnWindowDays: i.return_window_days_snapshot,
        returnPolicyLabel:
          i.return_policy_label_snapshot ??
          (i.returns_allowed_snapshot === false
            ? 'No Returns Available for This Item.'
            : null),
        returnPolicyDescription: i.return_policy_description_snapshot,
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
    approvalStatus?: string;
    qaStatus?: string;
    contactStatus?: string;
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
    if (opts?.approvalStatus) {
      params.push(opts.approvalStatus);
      where.push(`o.approval_status = $${params.length}`);
    }
    if (opts?.qaStatus) {
      params.push(opts.qaStatus);
      where.push(`o.qa_status = $${params.length}`);
    }
    if (opts?.contactStatus) {
      params.push(opts.contactStatus);
      where.push(`o.contact_status = $${params.length}`);
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
      approval_status: string;
      qa_status: string;
      contact_status: string;
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
      `SELECT o.id, o.order_number, o.status, o.payment_status,
              o.approval_status, o.qa_status, o.contact_status,
              o.fulfillment_type,
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
      approvalStatus: o.approval_status,
      qaStatus: o.qa_status,
      contactStatus: o.contact_status,
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
      approval_status: string;
      qa_status: string;
      contact_status: string;
      approval_notes: string | null;
      qa_notes: string | null;
      approved_at: Date | null;
      qa_checked_at: Date | null;
      contact_follow_up_at: Date | null;
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
      landmark_name: string | null;
      landmark_place_id: string | null;
      landmark_lng: string | null;
      landmark_lat: string | null;
      formatted_address: string | null;
      delivery_instructions: string | null;
      location_type: string | null;
      location_source: string | null;
      location_confirmed_at: Date | null;
      delivery_distance_km: string | null;
      delivery_fee_rate: string | null;
      delivery_route_source: string | null;
      delivery_pricing_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.fulfillment_type,
              o.approval_status, o.qa_status, o.contact_status,
              o.approval_notes, o.qa_notes,
              o.approved_at, o.qa_checked_at, o.contact_follow_up_at,
              o.subtotal::text, o.delivery_fee::text, o.grand_total::text, o.currency,
              o.ship_recipient_name, o.ship_recipient_phone, o.ship_address_text,
              o.customer_note, o.placed_at, o.guest_phone_e164,
              o.preferred_contact_channel, o.requires_manual_contact,
              o.estimated_delivery_at,
              o.landmark_name, o.landmark_place_id,
              o.landmark_lng::text, o.landmark_lat::text,
              o.formatted_address, o.delivery_instructions,
              o.location_type, o.location_source, o.location_confirmed_at,
              o.delivery_distance_km::text, o.delivery_fee_rate::text,
              o.delivery_route_source, o.delivery_pricing_snapshot,
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
      provider_reference: string | null;
      rejection_reason: string | null;
    }>(
      `SELECT pi.id AS intent_id, pi.status AS intent_status, pi.amount::text,
              t.id AS tx_id, t.status AS tx_status, m.code AS method_code,
              t.provider_reference, t.rejection_reason
       FROM payments.payment_intents pi
       LEFT JOIN LATERAL (
         SELECT id, status, payment_method_id, provider_reference, rejection_reason
         FROM payments.payment_transactions
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
      payload: Record<string, unknown> | null;
    }>(
      `SELECT id, event_code, channel, destination_masked, status,
              message_preview, last_error, attempt_count, created_at, sent_at,
              payload
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

    const { rows: contactCases } = await this.db.query<{
      id: string;
      reason_code: string;
      status: string;
      priority: string;
      title: string;
      details: string | null;
      follow_up_at: Date | null;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT id, reason_code, status, priority, title, details,
              follow_up_at, created_at, resolved_at
       FROM sales.customer_contact_cases
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [orderId],
    );

    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      approvalStatus: order.approval_status,
      qaStatus: order.qa_status,
      contactStatus: order.contact_status,
      approvalNotes: order.approval_notes,
      qaNotes: order.qa_notes,
      approvedAt: order.approved_at,
      qaCheckedAt: order.qa_checked_at,
      contactFollowUpAt: order.contact_follow_up_at,
      fulfillmentType: order.fulfillment_type,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      deliveryDistanceKm:
        order.delivery_distance_km != null
          ? Number(order.delivery_distance_km)
          : null,
      deliveryFeeRate:
        order.delivery_fee_rate != null
          ? Number(order.delivery_fee_rate)
          : null,
      deliveryRouteSource: order.delivery_route_source,
      deliveryPricingSnapshot: order.delivery_pricing_snapshot,
      grandTotal: Number(order.grand_total),
      currency: order.currency,
      shipping: {
        name: order.ship_recipient_name,
        phone: order.ship_recipient_phone,
        address: order.ship_address_text,
        lng: order.lng != null ? Number(order.lng) : null,
        lat: order.lat != null ? Number(order.lat) : null,
        landmarkName: order.landmark_name,
        landmarkPlaceId: order.landmark_place_id,
        landmarkLng:
          order.landmark_lng != null ? Number(order.landmark_lng) : null,
        landmarkLat:
          order.landmark_lat != null ? Number(order.landmark_lat) : null,
        formattedAddress: order.formatted_address,
        deliveryInstructions: order.delivery_instructions,
        locationType: order.location_type,
        locationSource: order.location_source,
        locationConfirmedAt: order.location_confirmed_at,
        googleMapsUrl:
          order.lat != null && order.lng != null
            ? googleMapsNavUrl(Number(order.lat), Number(order.lng))
            : null,
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
        providerReference: p.provider_reference,
        rejectionReason: p.rejection_reason,
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
        whatsappDeepLink:
          typeof n.payload?.whatsappDeepLink === 'string'
            ? n.payload.whatsappDeepLink
            : null,
      })),
      contactAttempts: contactAttempts.map((a) => ({
        id: a.id,
        channel: a.channel,
        outcome: a.outcome,
        notes: a.notes,
        attemptedAt: a.attempted_at,
        attemptedByName: a.full_name,
      })),
      contactCases: contactCases.map((c) => ({
        id: c.id,
        reasonCode: c.reason_code,
        status: c.status,
        priority: c.priority,
        title: c.title,
        details: c.details,
        followUpAt: c.follow_up_at,
        createdAt: c.created_at,
        resolvedAt: c.resolved_at,
      })),
    };
  }

  async adminApproveOrder(
    user: AuthUser,
    orderId: string,
    notes?: string,
  ) {
    const { rows } = await this.db.query<{
      id: string;
      payment_status: string;
      approval_status: string;
      status: string;
    }>(
      `SELECT id, payment_status, approval_status, status
       FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (order.payment_status !== 'paid') {
      throw new BadRequestException('Payment must be verified before approval');
    }
    if (order.approval_status === 'approved') {
      return this.adminGetOrder(orderId);
    }

    await this.db.query(
      `UPDATE sales.orders
       SET approval_status = 'approved',
           approved_by = $2,
           approved_at = now(),
           approval_notes = $3,
           status = CASE
             WHEN status IN ('confirmed', 'pending_payment') THEN 'processing'
             ELSE status
           END,
           qa_status = CASE
             WHEN qa_status = 'not_started' THEN 'pending'
             ELSE qa_status
           END,
           updated_at = now()
       WHERE id = $1`,
      [orderId, user.id, notes ?? null],
    );
    await this.db.query(
      `INSERT INTO sales.order_approvals
         (order_id, action, from_status, to_status, notes, actor_id)
       VALUES ($1, 'approved', $2, 'approved', $3, $4)`,
      [orderId, order.approval_status, notes ?? null, user.id],
    );
    await this.db.query(
      `INSERT INTO sales.order_status_history
         (order_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, 'processing', $3, $4)`,
      [
        orderId,
        order.status,
        notes ?? 'Admin approved order',
        user.id,
      ],
    );
    await this.db.query(
      `INSERT INTO notify.admin_alerts (alert_type, severity, title, body, order_id)
       VALUES ('qa_ready', 'info', 'Order ready for QA',
               'Approved — pending QA review', $1)`,
      [orderId],
    );
    return this.adminGetOrder(orderId);
  }

  async adminRejectOrder(
    user: AuthUser,
    orderId: string,
    notes?: string,
  ) {
    const { rows } = await this.db.query<{
      id: string;
      approval_status: string;
      status: string;
    }>(
      `SELECT id, approval_status, status FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Order not found');

    await this.db.query(
      `UPDATE sales.orders
       SET approval_status = 'rejected',
           approved_by = $2,
           approved_at = now(),
           approval_notes = $3,
           updated_at = now()
       WHERE id = $1`,
      [orderId, user.id, notes ?? null],
    );
    await this.db.query(
      `INSERT INTO sales.order_approvals
         (order_id, action, from_status, to_status, notes, actor_id)
       VALUES ($1, 'rejected', $2, 'rejected', $3, $4)`,
      [orderId, order.approval_status, notes ?? null, user.id],
    );
    return this.adminGetOrder(orderId);
  }

  async adminQaReview(
    user: AuthUser,
    orderId: string,
    body: {
      result: 'passed' | 'failed';
      notes?: string;
      checkedQtyOk?: boolean;
      variantsOk?: boolean;
      packagingOk?: boolean;
    },
  ) {
    const { rows } = await this.db.query<{
      id: string;
      payment_status: string;
      approval_status: string;
      qa_status: string;
      status: string;
    }>(
      `SELECT id, payment_status, approval_status, qa_status, status
       FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new NotFoundException('Order not found');
    if (order.payment_status !== 'paid') {
      throw new BadRequestException('Payment must be verified before QA');
    }
    if (order.approval_status !== 'approved') {
      throw new BadRequestException('Order must be approved before QA');
    }

    const toStatus = body.result === 'passed' ? 'passed' : 'failed';
    const nextOrderStatus =
      body.result === 'passed' ? 'ready_for_dispatch' : 'processing';

    await this.db.query(
      `UPDATE sales.orders
       SET qa_status = $2,
           qa_checked_by = $3,
           qa_checked_at = now(),
           qa_notes = $4,
           status = $5,
           updated_at = now()
       WHERE id = $1`,
      [orderId, toStatus, user.id, body.notes ?? null, nextOrderStatus],
    );
    await this.db.query(
      `INSERT INTO sales.order_qa_reviews
         (order_id, result, from_status, to_status, notes,
          checked_qty_ok, variants_ok, packaging_ok, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        orderId,
        body.result,
        order.qa_status,
        toStatus,
        body.notes ?? null,
        body.checkedQtyOk ?? null,
        body.variantsOk ?? null,
        body.packagingOk ?? null,
        user.id,
      ],
    );
    await this.db.query(
      `INSERT INTO sales.order_status_history
         (order_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        orderId,
        order.status,
        nextOrderStatus,
        body.notes ?? `QA ${body.result}`,
        user.id,
      ],
    );

    if (body.result === 'failed') {
      await this.db.query(
        `INSERT INTO notify.admin_alerts (alert_type, severity, title, body, order_id)
         VALUES ('qa_failed', 'critical', 'QA failed',
                 'Order failed QA and needs correction', $1)`,
        [orderId],
      );
    }

    return this.adminGetOrder(orderId);
  }

  async adminOpenContactCase(
    user: AuthUser,
    orderId: string,
    body: {
      reasonCode: string;
      title?: string;
      details?: string;
      priority?: string;
      followUpAt?: string;
    },
  ) {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM sales.orders WHERE id = $1`,
      [orderId],
    );
    if (!rowCount) throw new NotFoundException('Order not found');

    const reason = body.reasonCode || 'other';
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO sales.customer_contact_cases
         (order_id, reason_code, status, priority, title, details,
          follow_up_at, opened_by)
       VALUES ($1,$2,'open',$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        orderId,
        reason,
        body.priority ?? 'normal',
        body.title ?? 'Customer contact required',
        body.details ?? null,
        body.followUpAt ?? null,
        user.id,
      ],
    );

    await this.db.query(
      `UPDATE sales.orders
       SET contact_status = 'required',
           requires_manual_contact = true,
           contact_follow_up_at = coalesce($2::timestamptz, contact_follow_up_at),
           updated_at = now()
       WHERE id = $1`,
      [orderId, body.followUpAt ?? null],
    );

    await this.db.query(
      `INSERT INTO notify.admin_alerts (alert_type, severity, title, body, order_id)
       VALUES ('contact_required', 'warning', 'Customer contact required',
               $2, $1)`,
      [orderId, body.title ?? 'Customer contact required'],
    );

    return { caseId: rows[0].id, ...(await this.adminGetOrder(orderId)) };
  }

  async adminResolveContactCase(
    user: AuthUser,
    orderId: string,
    body: { caseId?: string; notes?: string; closeAll?: boolean },
  ) {
    if (body.caseId) {
      await this.db.query(
        `UPDATE sales.customer_contact_cases
         SET status = 'resolved',
             resolved_by = $2,
             resolved_at = now(),
             resolution_notes = $3,
             updated_at = now()
         WHERE id = $1 AND order_id = $4`,
        [body.caseId, user.id, body.notes ?? null, orderId],
      );
    } else if (body.closeAll) {
      await this.db.query(
        `UPDATE sales.customer_contact_cases
         SET status = 'resolved',
             resolved_by = $2,
             resolved_at = now(),
             resolution_notes = $3,
             updated_at = now()
         WHERE order_id = $1 AND status IN ('open', 'in_progress')`,
        [orderId, user.id, body.notes ?? null],
      );
    }

    const { rows: open } = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales.customer_contact_cases
       WHERE order_id = $1 AND status IN ('open', 'in_progress')`,
      [orderId],
    );

    if (Number(open[0]?.n ?? 0) === 0) {
      await this.db.query(
        `UPDATE sales.orders
         SET contact_status = 'resolved',
             requires_manual_contact = false,
             contact_resolved_at = now(),
             contact_resolved_by = $2,
             updated_at = now()
         WHERE id = $1`,
        [orderId, user.id],
      );
    }

    return this.adminGetOrder(orderId);
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
         SET requires_manual_contact = false,
             contact_status = 'resolved',
             contact_resolved_at = now(),
             contact_resolved_by = $2,
             updated_at = now()
         WHERE id = $1`,
        [orderId, user.id],
      );
      await this.db.query(
        `UPDATE sales.customer_contact_cases
         SET status = 'resolved',
             resolved_by = $2,
             resolved_at = now(),
             resolution_notes = coalesce(resolution_notes, 'Resolved via contact attempt'),
             updated_at = now()
         WHERE order_id = $1 AND status IN ('open', 'in_progress')`,
        [orderId, user.id],
      );
    } else {
      await this.db.query(
        `UPDATE sales.orders
         SET contact_status = CASE
               WHEN contact_status IN ('none', 'resolved', 'closed') THEN 'in_progress'
               ELSE contact_status
             END,
             updated_at = now()
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
      returns_allowed: boolean;
      return_window_days: number | null;
      return_policy_description: string | null;
    }>(
      `SELECT ci.id AS item_id, ci.variant_id, ci.quantity, pv.sku,
              p.name AS product_name, p.slug AS product_slug, pv.variant_name,
              p.bulk_purchasing_enabled,
              (sb.qty_on_hand - sb.qty_reserved)::text AS available,
              p.returns_allowed, p.return_window_days, p.return_policy_description
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
      const returnsAllowed = r.returns_allowed !== false;
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
        returnsAllowed,
        returnWindowDays: returnsAllowed ? (r.return_window_days ?? 7) : null,
        returnPolicyLabel: returnsAllowed
          ? `Returns within ${r.return_window_days ?? 7} day(s)`
          : 'No Returns Available for This Item.',
        returnPolicyDescription: r.return_policy_description,
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

function googleMapsNavUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

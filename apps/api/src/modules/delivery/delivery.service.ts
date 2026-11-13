import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest();
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

@Injectable()
export class DeliveryService {
  readonly schema = 'delivery' as const;
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private webBase() {
    return (
      this.config.get<string>('PUBLIC_WEB_URL')?.replace(/\/$/, '') ??
      'http://localhost:3000'
    );
  }

  async getSettings() {
    const { rows } = await this.db.query<{
      offer_ttl_minutes: number;
      default_speed_kmh: string;
      fee_per_km: string;
      min_fee: string;
      max_fee: string | null;
      free_over_amount: string | null;
      origin_lng: number | null;
      origin_lat: number | null;
      origin_warehouse_id: string | null;
      warehouse_name: string | null;
      warehouse_address: string | null;
      standard_enabled: boolean;
      express_enabled: boolean;
      standard_base_fare: string;
      express_base_fare: string;
      express_fee_per_km: string | null;
      express_surcharge: string;
      peak_surcharge: string;
      holiday_surcharge: string;
      standard_eta_buffer_minutes: number;
      express_eta_buffer_minutes: number;
      express_speed_kmh: string | null;
      promo_discount_amount: string;
      promo_discount_percent: string;
      promo_label: string | null;
      eta_disclaimer: string;
    }>(
      `SELECT s.offer_ttl_minutes, s.default_speed_kmh::text,
              s.fee_per_km::text, s.min_fee::text, s.max_fee::text,
              s.free_over_amount::text, s.origin_lng, s.origin_lat,
              s.origin_warehouse_id, w.name AS warehouse_name, w.address_text AS warehouse_address,
              s.standard_enabled, s.express_enabled,
              s.standard_base_fare::text, s.express_base_fare::text,
              s.express_fee_per_km::text, s.express_surcharge::text,
              s.peak_surcharge::text, s.holiday_surcharge::text,
              s.standard_eta_buffer_minutes, s.express_eta_buffer_minutes,
              s.express_speed_kmh::text,
              s.promo_discount_amount::text, s.promo_discount_percent::text,
              s.promo_label, s.eta_disclaimer
       FROM delivery.dispatch_settings s
       LEFT JOIN inventory.warehouses w ON w.id = s.origin_warehouse_id
       WHERE s.id = 1`,
    );
    const r = rows[0];
    const expressFeePerKm =
      r?.express_fee_per_km != null ? Number(r.express_fee_per_km) : null;
    const expressConfigured =
      expressFeePerKm != null && !Number.isNaN(expressFeePerKm);
    return {
      offerTtlMinutes: r?.offer_ttl_minutes ?? 15,
      defaultSpeedKmh: Number(r?.default_speed_kmh ?? 25),
      feePerKm: Number(r?.fee_per_km ?? 5),
      minFee: Number(r?.min_fee ?? 100),
      maxFee: r?.max_fee != null ? Number(r.max_fee) : null,
      freeOverAmount:
        r?.free_over_amount != null ? Number(r.free_over_amount) : null,
      originLng: r?.origin_lng ?? 38.7125,
      originLat: r?.origin_lat ?? 9.033,
      originWarehouseId: r?.origin_warehouse_id ?? null,
      originName: r?.warehouse_name ?? 'Kolfe Atena Tera',
      originAddress:
        r?.warehouse_address ?? 'Kolfe Atena Tera, Addis Ababa, Ethiopia',
      standardEnabled: r?.standard_enabled ?? true,
      expressEnabled: Boolean(r?.express_enabled && expressConfigured),
      expressConfigured,
      standardBaseFare: Number(r?.standard_base_fare ?? 100),
      expressBaseFare: Number(r?.express_base_fare ?? 100),
      expressFeePerKm,
      expressSurcharge: Number(r?.express_surcharge ?? 0),
      peakSurcharge: Number(r?.peak_surcharge ?? 0),
      holidaySurcharge: Number(r?.holiday_surcharge ?? 0),
      standardEtaBufferMinutes: r?.standard_eta_buffer_minutes ?? 20,
      expressEtaBufferMinutes: r?.express_eta_buffer_minutes ?? 10,
      expressSpeedKmh:
        r?.express_speed_kmh != null ? Number(r.express_speed_kmh) : null,
      promoDiscountAmount: Number(r?.promo_discount_amount ?? 0),
      promoDiscountPercent: Number(r?.promo_discount_percent ?? 0),
      promoLabel: r?.promo_label ?? null,
      etaDisclaimer:
        r?.eta_disclaimer ??
        'Estimated delivery time may vary depending on traffic conditions, weather, driver availability, and other unexpected delays.',
    };
  }

  async updateSettings(input: {
    offerTtlMinutes?: number;
    defaultSpeedKmh?: number;
    feePerKm?: number;
    minFee?: number;
    maxFee?: number | null;
    freeOverAmount?: number | null;
    originLng?: number;
    originLat?: number;
    standardEnabled?: boolean;
    expressEnabled?: boolean;
    standardBaseFare?: number;
    expressBaseFare?: number;
    expressFeePerKm?: number | null;
    expressSurcharge?: number;
    peakSurcharge?: number;
    holidaySurcharge?: number;
    standardEtaBufferMinutes?: number;
    expressEtaBufferMinutes?: number;
    expressSpeedKmh?: number | null;
    promoDiscountAmount?: number;
    promoDiscountPercent?: number;
    promoLabel?: string | null;
    etaDisclaimer?: string;
    actorId?: string;
  }) {
    const before = await this.getSettings();

    // Express cannot be enabled until a rate is configured
    let expressEnabled = input.expressEnabled;
    const nextExpressRate =
      input.expressFeePerKm !== undefined
        ? input.expressFeePerKm
        : before.expressFeePerKm;
    if (expressEnabled === true && (nextExpressRate == null || nextExpressRate < 0)) {
      expressEnabled = false;
    }

    await this.db.query(
      `UPDATE delivery.dispatch_settings SET
         offer_ttl_minutes = COALESCE($1, offer_ttl_minutes),
         default_speed_kmh = COALESCE($2, default_speed_kmh),
         fee_per_km = COALESCE($3, fee_per_km),
         min_fee = COALESCE($4, min_fee),
         max_fee = CASE WHEN $5::boolean THEN $6 ELSE max_fee END,
         free_over_amount = CASE WHEN $7::boolean THEN $8 ELSE free_over_amount END,
         origin_lng = COALESCE($9, origin_lng),
         origin_lat = COALESCE($10, origin_lat),
         standard_enabled = COALESCE($11, standard_enabled),
         express_enabled = COALESCE($12, express_enabled),
         standard_base_fare = COALESCE($13, standard_base_fare),
         express_base_fare = COALESCE($14, express_base_fare),
         express_fee_per_km = CASE WHEN $15::boolean THEN $16 ELSE express_fee_per_km END,
         express_surcharge = COALESCE($17, express_surcharge),
         peak_surcharge = COALESCE($18, peak_surcharge),
         holiday_surcharge = COALESCE($19, holiday_surcharge),
         standard_eta_buffer_minutes = COALESCE($20, standard_eta_buffer_minutes),
         express_eta_buffer_minutes = COALESCE($21, express_eta_buffer_minutes),
         express_speed_kmh = CASE WHEN $22::boolean THEN $23 ELSE express_speed_kmh END,
         promo_discount_amount = COALESCE($24, promo_discount_amount),
         promo_discount_percent = COALESCE($25, promo_discount_percent),
         promo_label = CASE WHEN $26::boolean THEN $27 ELSE promo_label END,
         eta_disclaimer = COALESCE($28, eta_disclaimer),
         updated_at = now()
       WHERE id = 1`,
      [
        input.offerTtlMinutes ?? null,
        input.defaultSpeedKmh ?? null,
        input.feePerKm ?? null,
        input.minFee ?? null,
        input.maxFee !== undefined,
        input.maxFee ?? null,
        input.freeOverAmount !== undefined,
        input.freeOverAmount ?? null,
        input.originLng ?? null,
        input.originLat ?? null,
        input.standardEnabled ?? null,
        expressEnabled ?? null,
        input.standardBaseFare ?? null,
        input.expressBaseFare ?? null,
        input.expressFeePerKm !== undefined,
        input.expressFeePerKm ?? null,
        input.expressSurcharge ?? null,
        input.peakSurcharge ?? null,
        input.holidaySurcharge ?? null,
        input.standardEtaBufferMinutes ?? null,
        input.expressEtaBufferMinutes ?? null,
        input.expressSpeedKmh !== undefined,
        input.expressSpeedKmh ?? null,
        input.promoDiscountAmount ?? null,
        input.promoDiscountPercent ?? null,
        input.promoLabel !== undefined,
        input.promoLabel ?? null,
        input.etaDisclaimer ?? null,
      ],
    );

    await this.db.query(
      `UPDATE delivery.service_types
       SET is_enabled = COALESCE($1, is_enabled), updated_at = now()
       WHERE code = 'standard'`,
      [input.standardEnabled ?? null],
    );
    await this.db.query(
      `UPDATE delivery.service_types
       SET is_enabled = COALESCE($1, is_enabled), updated_at = now()
       WHERE code = 'express'`,
      [expressEnabled ?? null],
    );

    if (input.originLng != null && input.originLat != null) {
      await this.db.query(
        `UPDATE inventory.warehouses
         SET location = ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
             updated_at = now()
         WHERE code = 'ADD-MAIN'`,
        [input.originLng, input.originLat],
      );
    }

    const after = await this.getSettings();
    await this.db.query(
      `INSERT INTO delivery.pricing_audit_logs
         (actor_id, action, before_snapshot, after_snapshot)
       VALUES ($1, 'settings_updated', $2::jsonb, $3::jsonb)`,
      [input.actorId ?? null, JSON.stringify(before), JSON.stringify(after)],
    );
    await this.db.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('delivery', 'dispatch_settings', 'delivery.pricing_updated', $1::jsonb)`,
      [
        JSON.stringify({
          actorId: input.actorId ?? null,
          at: new Date().toISOString(),
          after,
        }),
      ],
    );
    return after;
  }

  /**
   * Kolfe Atena Tera origin quote.
   * Standard: baseFare + (km × rate). Express: only when admin-enabled + rate set.
   */
  async quoteDelivery(opts: {
    lat?: number;
    lng?: number;
    subtotal?: number;
    serviceType?: 'standard' | 'express';
  }) {
    const settings = await this.getSettings();
    const requested = opts.serviceType ?? 'standard';
    const etaDisclaimer = settings.etaDisclaimer;

    const services = [
      {
        code: 'standard' as const,
        name: 'Standard Delivery',
        enabled: settings.standardEnabled,
        available: settings.standardEnabled,
        unavailableReason: settings.standardEnabled
          ? null
          : 'Standard delivery is temporarily unavailable',
      },
      {
        code: 'express' as const,
        name: 'Express Delivery',
        enabled: settings.expressEnabled,
        available: settings.expressEnabled && settings.expressConfigured,
        unavailableReason: !settings.expressConfigured
          ? 'Express pricing has not been configured by the administrator'
          : !settings.expressEnabled
            ? 'Express delivery is currently disabled'
            : null,
      },
    ];

    if (
      opts.lat == null ||
      opts.lng == null ||
      Number.isNaN(opts.lat) ||
      Number.isNaN(opts.lng)
    ) {
      return {
        pendingAdmin: true,
        routeSource: 'pending' as const,
        serviceType: requested,
        distanceKm: null,
        feePerKm: settings.feePerKm,
        baseFare: settings.standardBaseFare,
        deliveryFee: null,
        etaMinutes: null,
        etaWindowText: null,
        etaIsEstimate: true,
        etaDisclaimer,
        minApplied: false,
        maxApplied: false,
        freeApplied: false,
        services,
        origin: {
          lng: settings.originLng,
          lat: settings.originLat,
          name: settings.originName,
          address: settings.originAddress,
        },
        message:
          'Confirm a delivery pin on the map to calculate distance and fee.',
      };
    }

    const service = services.find((s) => s.code === requested) ?? services[0];
    if (!service.available) {
      throw new BadRequestException(
        service.unavailableReason ??
          `${service.name} is not available`,
      );
    }

    const { rows } = await this.db.query<{ distance_m: string }>(
      `SELECT ST_Distance(
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography
       )::text AS distance_m`,
      [settings.originLng, settings.originLat, opts.lng, opts.lat],
    );
    const distanceKm = round1(Number(rows[0]?.distance_m ?? 0) / 1000);

    const isExpress = requested === 'express';
    const baseFare = isExpress
      ? settings.expressBaseFare
      : settings.standardBaseFare;
    const feePerKm = isExpress
      ? (settings.expressFeePerKm as number)
      : settings.feePerKm;
    const serviceSurcharge = isExpress ? settings.expressSurcharge : 0;
    const distanceCharge = round1(distanceKm * feePerKm);
    let deliveryFee =
      baseFare +
      distanceCharge +
      serviceSurcharge +
      settings.peakSurcharge +
      settings.holidaySurcharge;

    let maxApplied = false;
    let freeApplied = false;
    let promoApplied = 0;

    if (settings.maxFee != null && deliveryFee > settings.maxFee) {
      deliveryFee = settings.maxFee;
      maxApplied = true;
    }

    if (settings.promoDiscountPercent > 0) {
      const pctOff = (deliveryFee * settings.promoDiscountPercent) / 100;
      promoApplied += pctOff;
      deliveryFee -= pctOff;
    }
    if (settings.promoDiscountAmount > 0) {
      promoApplied += settings.promoDiscountAmount;
      deliveryFee -= settings.promoDiscountAmount;
    }
    if (deliveryFee < 0) deliveryFee = 0;

    if (
      opts.subtotal != null &&
      settings.freeOverAmount != null &&
      opts.subtotal >= settings.freeOverAmount
    ) {
      deliveryFee = 0;
      freeApplied = true;
    }

    deliveryFee = Math.round(deliveryFee * 100) / 100;
    promoApplied = Math.round(promoApplied * 100) / 100;

    const speedKmh = isExpress
      ? settings.expressSpeedKmh ?? settings.defaultSpeedKmh * 1.25
      : settings.defaultSpeedKmh;
    const buffer = isExpress
      ? settings.expressEtaBufferMinutes
      : settings.standardEtaBufferMinutes;
    const driveMinutes = Math.ceil((distanceKm / Math.max(speedKmh, 1)) * 60);
    const etaMinutes = Math.max(20, driveMinutes + buffer);
    const etaLow = Math.max(15, etaMinutes - 10);
    const etaHigh = etaMinutes + 15;
    const etaWindowText = `Estimated arrival in about ${etaLow}–${etaHigh} minutes`;

    return {
      pendingAdmin: false,
      routeSource: 'geodesic' as const,
      serviceType: requested,
      distanceKm,
      feePerKm,
      baseFare,
      distanceCharge,
      serviceSurcharge,
      peakSurcharge: settings.peakSurcharge,
      holidaySurcharge: settings.holidaySurcharge,
      promoApplied,
      promoLabel: settings.promoLabel,
      deliveryFee,
      etaMinutes,
      etaWindowText,
      etaIsEstimate: true,
      etaDisclaimer,
      minApplied: false,
      maxApplied,
      freeApplied,
      services,
      origin: {
        lng: settings.originLng,
        lat: settings.originLat,
        name: settings.originName,
        address: settings.originAddress,
      },
      message: `${service.name}: ${baseFare} ETB base + ${distanceKm} km × ${feePerKm} ETB/km${
        serviceSurcharge ? ` + ${serviceSurcharge} ETB surcharge` : ''
      } (estimate).`,
      snapshot: {
        serviceType: requested,
        distanceKm,
        feePerKm,
        baseFare,
        distanceCharge,
        serviceSurcharge,
        peakSurcharge: settings.peakSurcharge,
        holidaySurcharge: settings.holidaySurcharge,
        promoApplied,
        deliveryFee,
        etaMinutes,
        etaWindowText,
        etaIsEstimate: true,
        etaDisclaimer,
        maxFee: settings.maxFee,
        freeOverAmount: settings.freeOverAmount,
        maxApplied,
        freeApplied,
        routeSource: 'geodesic',
        originLng: settings.originLng,
        originLat: settings.originLat,
      },
    };
  }

  /** Orders ready for delivery dispatch (paid/confirmed, local delivery). */
  async listDispatchQueue() {
    const { rows } = await this.db.query<{
      order_id: string;
      order_number: string;
      status: string;
      payment_status: string;
      grand_total: string;
      ship_recipient_name: string | null;
      ship_recipient_phone: string | null;
      ship_address_text: string | null;
      lng: string | null;
      lat: string | null;
      placed_at: Date | null;
      item_count: string;
      delivery_id: string | null;
      delivery_number: string | null;
      delivery_status: string | null;
    }>(
      `SELECT o.id AS order_id, o.order_number, o.status, o.payment_status,
              o.grand_total::text, o.ship_recipient_name, o.ship_recipient_phone,
              o.ship_address_text,
              ST_X(o.ship_location::geometry)::text AS lng,
              ST_Y(o.ship_location::geometry)::text AS lat,
              o.placed_at,
              (SELECT count(*)::text FROM sales.order_items oi WHERE oi.order_id = o.id) AS item_count,
              d.id AS delivery_id, d.delivery_number, d.status AS delivery_status
       FROM sales.orders o
       LEFT JOIN LATERAL (
         SELECT id, delivery_number, status
         FROM delivery.deliveries
         WHERE order_id = o.id
           AND status NOT IN ('cancelled','returned_to_warehouse')
         ORDER BY created_at DESC
         LIMIT 1
       ) d ON true
       WHERE o.fulfillment_type = 'local_delivery'
         AND o.payment_status = 'paid'
         AND o.status IN ('confirmed','processing','ready_for_dispatch','dispatched')
       ORDER BY o.placed_at DESC NULLS LAST
       LIMIT 100`,
    );

    return rows.map((r) => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      orderStatus: r.status,
      paymentStatus: r.payment_status,
      grandTotal: Number(r.grand_total),
      recipientName: r.ship_recipient_name,
      recipientPhone: r.ship_recipient_phone,
      address: r.ship_address_text,
      lng: r.lng != null ? Number(r.lng) : null,
      lat: r.lat != null ? Number(r.lat) : null,
      placedAt: r.placed_at,
      itemCount: Number(r.item_count),
      deliveryId: r.delivery_id,
      deliveryNumber: r.delivery_number,
      deliveryStatus: r.delivery_status,
    }));
  }

  async listDeliveries(status?: string) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (status) {
      params.push(status);
      where = `d.status = $${params.length}`;
    }
    const { rows } = await this.db.query<{
      id: string;
      delivery_number: string;
      status: string;
      order_number: string;
      dropoff_address_text: string;
      recipient_name: string;
      recipient_phone: string;
      distance_km: string | null;
      eta_minutes: number | null;
      driver_name: string | null;
      driver_phone: string | null;
      assignment_status: string | null;
      created_at: Date;
    }>(
      `SELECT d.id, d.delivery_number, d.status, o.order_number,
              d.dropoff_address_text, d.recipient_name, d.recipient_phone,
              d.distance_km::text, d.eta_minutes,
              u.full_name AS driver_name, u.phone_e164 AS driver_phone,
              a.status AS assignment_status, d.created_at
       FROM delivery.deliveries d
       JOIN sales.orders o ON o.id = d.order_id
       LEFT JOIN delivery.driver_assignments a
         ON a.delivery_id = d.id AND a.status IN ('offered','accepted','completed')
       LEFT JOIN delivery.drivers dr ON dr.id = a.driver_id
       LEFT JOIN iam.users u ON u.id = dr.user_id
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      deliveryNumber: r.delivery_number,
      status: r.status,
      orderNumber: r.order_number,
      address: r.dropoff_address_text,
      recipientName: r.recipient_name,
      recipientPhone: r.recipient_phone,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      etaMinutes: r.eta_minutes,
      driverName: r.driver_name,
      driverPhone: r.driver_phone,
      assignmentStatus: r.assignment_status,
      createdAt: r.created_at,
    }));
  }

  async getDeliveryAdmin(deliveryId: string) {
    const base = await this.loadDeliveryDetail(deliveryId);
    const { rows: assignments } = await this.db.query<{
      id: string;
      status: string;
      driver_name: string;
      driver_code: string;
      driver_phone: string | null;
      offered_at: Date;
      responded_at: Date | null;
      offer_expires_at: Date | null;
      assigned_by_name: string | null;
    }>(
      `SELECT a.id, a.status, u.full_name AS driver_name, dr.driver_code,
              u.phone_e164 AS driver_phone,
              a.offered_at, a.responded_at, a.offer_expires_at,
              ab.full_name AS assigned_by_name
       FROM delivery.driver_assignments a
       JOIN delivery.drivers dr ON dr.id = a.driver_id
       JOIN iam.users u ON u.id = dr.user_id
       LEFT JOIN iam.users ab ON ab.id = a.assigned_by
       WHERE a.delivery_id = $1
       ORDER BY a.offered_at DESC`,
      [deliveryId],
    );
    return {
      ...base,
      assignments: assignments.map((o) => ({
        id: o.id,
        status: o.status,
        driverName: o.driver_name,
        driverCode: o.driver_code,
        driverPhone: o.driver_phone,
        offeredAt: o.offered_at,
        respondedAt: o.responded_at,
        expiresAt: o.offer_expires_at,
        assignedByName: o.assigned_by_name,
      })),
      /** @deprecated use assignments — kept for older admin clients */
      offers: assignments.map((o) => ({
        id: o.id,
        status: o.status,
        driverName: o.driver_name,
        driverCode: o.driver_code,
        offeredAt: o.offered_at,
        respondedAt: o.responded_at,
        expiresAt: o.offer_expires_at,
      })),
    };
  }

  async listAvailableDrivers() {
    const all = await this.listDrivers({ forDispatch: true });
    return all;
  }

  async listDrivers(opts?: { forDispatch?: boolean }) {
    const where = opts?.forDispatch
      ? `dr.status = 'active' AND dr.availability IN ('available','on_break')`
      : `dr.status <> 'terminated'`;
    const { rows } = await this.db.query<{
      id: string;
      driver_code: string;
      full_name: string;
      phone_e164: string | null;
      availability: string;
      status: string;
      employment_type: string;
      zone_name: string | null;
      license_expiry: Date;
      active_deliveries: string;
    }>(
      `SELECT dr.id, dr.driver_code, u.full_name, u.phone_e164, dr.availability,
              dr.status, dr.employment_type, z.name AS zone_name, dr.license_expiry,
              (
                SELECT count(*)::text FROM delivery.driver_assignments a
                WHERE a.driver_id = dr.id AND a.status IN ('offered','accepted')
              ) AS active_deliveries
       FROM delivery.drivers dr
       JOIN iam.users u ON u.id = dr.user_id
       LEFT JOIN delivery.delivery_zones z ON z.id = dr.home_zone_id
       WHERE ${where}
       ORDER BY dr.created_at DESC, u.full_name`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.driver_code,
      name: r.full_name,
      phone: r.phone_e164,
      availability: r.availability,
      status: r.status,
      employmentType: r.employment_type,
      zoneName: r.zone_name,
      licenseExpiry: r.license_expiry,
      activeDeliveries: Number(r.active_deliveries),
    }));
  }

  async listZones() {
    const { rows } = await this.db.query<{
      id: string;
      name: string;
    }>(
      `SELECT id, name FROM delivery.delivery_zones WHERE is_active ORDER BY name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async createDriver(
    actor: AuthUser,
    input: {
      fullName: string;
      phone: string;
      employmentType?: 'employee' | 'contractor';
      homeZoneId?: string;
      licenseNumber: string;
      licenseExpiry: string;
      availability?: 'offline' | 'available' | 'on_break';
      activate?: boolean;
    },
  ) {
    if (!/^\+[1-9][0-9]{7,14}$/.test(input.phone)) {
      throw new BadRequestException('Phone must be E.164 (+251...)');
    }
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');

      const { rows: existingUser } = await client.query<{ id: string }>(
        `SELECT id FROM iam.users WHERE phone_e164 = $1 AND deleted_at IS NULL`,
        [input.phone],
      );
      let userId = existingUser[0]?.id;
      if (userId) {
        const { rows: existingDriver } = await client.query<{ id: string }>(
          `SELECT id FROM delivery.drivers WHERE user_id = $1`,
          [userId],
        );
        if (existingDriver[0]) {
          throw new ConflictException('A driver already exists for this phone');
        }
        await client.query(
          `UPDATE iam.users
           SET user_type = 'driver', full_name = $2, status = 'active',
               phone_verified_at = COALESCE(phone_verified_at, now()), updated_at = now()
           WHERE id = $1`,
          [userId, input.fullName],
        );
      } else {
        const { rows: created } = await client.query<{ id: string }>(
          `INSERT INTO iam.users (
             user_type, phone_e164, full_name, status, phone_verified_at
           ) VALUES ('driver', $1, $2, 'active', now())
           RETURNING id`,
          [input.phone, input.fullName],
        );
        userId = created[0].id;
      }

      await client.query(
        `INSERT INTO iam.user_roles (user_id, role_id)
         SELECT $1, r.id FROM iam.roles r
         WHERE r.code = 'driver'
           AND NOT EXISTS (
             SELECT 1 FROM iam.user_roles ur
             WHERE ur.user_id = $1 AND ur.role_id = r.id
           )`,
        [userId],
      );

      const { rows: regions } = await client.query<{ id: string }>(
        `SELECT id FROM core.operating_regions WHERE code = 'ET' LIMIT 1`,
      );
      if (!regions[0]) throw new BadRequestException('ET region missing');

      let zoneId = input.homeZoneId ?? null;
      if (!zoneId) {
        const { rows: zones } = await client.query<{ id: string }>(
          `SELECT id FROM delivery.delivery_zones WHERE is_active ORDER BY name LIMIT 1`,
        );
        zoneId = zones[0]?.id ?? null;
      }

      const driverCode = await this.nextDocNumber(client, 'DRV');
      const licenseHash = sha256(input.licenseNumber.trim().toUpperCase());
      // Placeholder envelope encryption until KMS is wired
      const licenseEnc = Buffer.from(input.licenseNumber, 'utf8');

      const activate = input.activate !== false;
      const { rows: drivers } = await client.query<{ id: string }>(
        `INSERT INTO delivery.drivers (
           user_id, driver_code, employment_type, home_zone_id, region_id,
           license_number_enc, license_number_hash, license_expiry,
           status, availability, verified_by, verified_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
         ) RETURNING id`,
        [
          userId,
          driverCode,
          input.employmentType ?? 'contractor',
          zoneId,
          regions[0].id,
          licenseEnc,
          licenseHash,
          input.licenseExpiry,
          activate ? 'active' : 'pending_verification',
          input.availability ?? 'available',
          activate ? actor.id : null,
          activate ? new Date().toISOString() : null,
        ],
      );

      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('driver', $1, 'driver.created', $2::jsonb)`,
        [
          drivers[0].id,
          JSON.stringify({
            driverId: drivers[0].id,
            code: driverCode,
            phone: input.phone,
            name: input.fullName,
          }),
        ],
      );

      await client.query('COMMIT');
      return {
        id: drivers[0].id,
        code: driverCode,
        name: input.fullName,
        phone: input.phone,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Driver code or license already exists');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async updateDriver(
    driverId: string,
    input: {
      availability?: 'offline' | 'available' | 'on_delivery' | 'on_break';
      status?: 'pending_verification' | 'active' | 'suspended' | 'terminated';
      homeZoneId?: string | null;
    },
  ) {
    const { rowCount } = await this.db.query(
      `UPDATE delivery.drivers SET
         availability = COALESCE($2, availability),
         status = COALESCE($3, status),
         home_zone_id = COALESCE($4, home_zone_id),
         updated_at = now()
       WHERE id = $1`,
      [
        driverId,
        input.availability ?? null,
        input.status ?? null,
        input.homeZoneId === undefined ? null : input.homeZoneId,
      ],
    );
    if (!rowCount) throw new NotFoundException('Driver not found');
    const list = await this.listDrivers();
    return list.find((d) => d.id === driverId) ?? { id: driverId };
  }

  async createDeliveryFromOrder(user: AuthUser, orderId: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: orders } = await client.query<{
        id: string;
        order_number: string;
        status: string;
        payment_status: string;
        ship_recipient_name: string;
        ship_recipient_phone: string;
        ship_address_text: string;
        fulfillment_warehouse_id: string;
        delivery_instructions: string | null;
        landmark_name: string | null;
        landmark_place_id: string | null;
        location_type: string | null;
        dropoff_lng: string | null;
        dropoff_lat: string | null;
      }>(
        `SELECT id, order_number, status, payment_status,
                ship_recipient_name, ship_recipient_phone, ship_address_text,
                fulfillment_warehouse_id, delivery_instructions,
                landmark_name, landmark_place_id, location_type,
                ST_X(ship_location::geometry)::text AS dropoff_lng,
                ST_Y(ship_location::geometry)::text AS dropoff_lat
         FROM sales.orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');
      if (order.payment_status !== 'paid') {
        throw new BadRequestException('Order must be paid before dispatch');
      }

      const { rows: gates } = await client.query<{
        approval_status: string;
        qa_status: string;
      }>(
        `SELECT approval_status, qa_status FROM sales.orders WHERE id = $1`,
        [orderId],
      );
      const gate = gates[0];
      if (gate && gate.approval_status !== 'approved') {
        throw new BadRequestException(
          'Order must be approved by admin before dispatch',
        );
      }
      if (gate && gate.qa_status !== 'passed') {
        throw new BadRequestException(
          'Order must pass QA before driver assignment',
        );
      }

      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM delivery.deliveries
         WHERE order_id = $1 AND status NOT IN ('cancelled','failed','delivered','returned_to_warehouse')
         LIMIT 1`,
        [orderId],
      );
      if (existing[0]) {
        throw new ConflictException('Active delivery already exists for this order');
      }

      const settings = await this.getSettings();
      const { rows: dist } = await client.query<{ km: string; minutes: string }>(
        `SELECT
           (ST_Distance(w.location, o.ship_location) / 1000.0)::text AS km,
           CEIL((ST_Distance(w.location, o.ship_location) / 1000.0) / $2 * 60)::text AS minutes
         FROM sales.orders o
         JOIN inventory.warehouses w ON w.id = o.fulfillment_warehouse_id
         WHERE o.id = $1`,
        [orderId, settings.defaultSpeedKmh],
      );
      const distanceKm = dist[0] ? round1(Number(dist[0].km)) : null;
      const etaMinutes = dist[0] ? Math.max(15, Number(dist[0].minutes)) : 35;

      const { rows: zones } = await client.query<{ id: string }>(
        `SELECT id FROM delivery.delivery_zones WHERE is_active LIMIT 1`,
      );

      const deliveryNumber = await this.nextDocNumber(client, 'DEL');
      const { rows: items } = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM sales.order_items WHERE order_id = $1`,
        [orderId],
      );

      const mapsUrl =
        order.dropoff_lat != null && order.dropoff_lng != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${order.dropoff_lat},${order.dropoff_lng}`
          : null;

      const { rows: dels } = await client.query<{ id: string }>(
        `INSERT INTO delivery.deliveries (
           delivery_number, order_id, origin_warehouse_id, zone_id,
           dropoff_location, dropoff_address_text, recipient_name, recipient_phone,
           distance_km, status, package_count, eta_minutes,
           delivery_instructions, landmark_name, landmark_place_id,
           location_type, google_maps_url
         ) VALUES (
           $1,$2,$3,$4,
           (SELECT ship_location FROM sales.orders WHERE id = $2),
           $5,$6,$7,$8,'pending_assignment',$9,$10,
           $11,$12,$13,$14,$15
         ) RETURNING id`,
        [
          deliveryNumber,
          orderId,
          order.fulfillment_warehouse_id,
          zones[0]?.id ?? null,
          order.ship_address_text,
          order.ship_recipient_name,
          order.ship_recipient_phone,
          distanceKm,
          items.length || 1,
          etaMinutes,
          order.delivery_instructions,
          order.landmark_name,
          order.landmark_place_id,
          order.location_type,
          mapsUrl,
        ],
      );
      const deliveryId = dels[0].id;
      for (const item of items) {
        await client.query(
          `INSERT INTO delivery.delivery_items (delivery_id, order_item_id, quantity)
           VALUES ($1,$2,$3)`,
          [deliveryId, item.id, item.quantity],
        );
      }
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, to_status, actor_id)
         VALUES ($1,'created','pending_assignment',$2)`,
        [deliveryId, user.id],
      );
      await client.query('COMMIT');
      return this.getDeliveryAdmin(deliveryId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Legacy offer endpoint — now performs direct admin assignment (no driver accept).
   */
  async offerToDriver(user: AuthUser, deliveryId: string, driverId: string) {
    return this.assignDriverDirectly(user, deliveryId, driverId);
  }

  /**
   * Admin manually assigns (or reassigns) a driver after contacting them by phone.
   * No accept/decline step — assignment is immediate. Issues QR/PIN for PoD.
   */
  async assignDriverDirectly(
    user: AuthUser,
    deliveryId: string,
    driverId: string,
  ) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: dels } = await client.query<{
        id: string;
        status: string;
        delivery_number: string;
        dropoff_address_text: string;
        distance_km: string | null;
        eta_minutes: number | null;
        order_id: string;
        order_number: string;
        warehouse_name: string;
        recipient_name: string;
        recipient_phone: string;
      }>(
        `SELECT d.id, d.status, d.delivery_number, d.dropoff_address_text,
                d.distance_km::text, d.eta_minutes, o.id AS order_id, o.order_number,
                w.name AS warehouse_name, d.recipient_name, d.recipient_phone
         FROM delivery.deliveries d
         JOIN sales.orders o ON o.id = d.order_id
         JOIN inventory.warehouses w ON w.id = d.origin_warehouse_id
         WHERE d.id = $1 FOR UPDATE OF d`,
        [deliveryId],
      );
      const del = dels[0];
      if (!del) throw new NotFoundException('Delivery not found');
      if (
        ['delivered', 'cancelled', 'returned_to_warehouse', 'failed'].includes(
          del.status,
        )
      ) {
        throw new BadRequestException(
          `Cannot assign delivery in status=${del.status}`,
        );
      }

      const { rows: prior } = await client.query<{
        id: string;
        driver_id: string;
        status: string;
      }>(
        `SELECT id, driver_id, status FROM delivery.driver_assignments
         WHERE delivery_id = $1 AND status IN ('offered','accepted')
         FOR UPDATE`,
        [deliveryId],
      );
      const previousDriverIds = new Set<string>();
      for (const row of prior) {
        previousDriverIds.add(row.driver_id);
        await client.query(
          `UPDATE delivery.driver_assignments
           SET status = CASE WHEN status = 'offered' THEN 'expired' ELSE 'cancelled' END,
               responded_at = COALESCE(responded_at, now())
           WHERE id = $1`,
          [row.id],
        );
      }

      const { rows: drivers } = await client.query<{
        id: string;
        full_name: string;
        phone_e164: string | null;
        availability: string;
        status: string;
      }>(
        `SELECT dr.id, u.full_name, u.phone_e164, dr.availability, dr.status
         FROM delivery.drivers dr
         JOIN iam.users u ON u.id = dr.user_id
         WHERE dr.id = $1 FOR UPDATE OF dr`,
        [driverId],
      );
      const driver = drivers[0];
      if (!driver || driver.status !== 'active') {
        throw new BadRequestException('Driver not available');
      }

      const portalToken = randomBytes(24).toString('base64url');
      // Long-lived portal token for QR/PIN verification (not an accept TTL)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);

      const { rows: assigns } = await client.query<{ id: string }>(
        `INSERT INTO delivery.driver_assignments (
           delivery_id, driver_id, assigned_by, assignment_method, status,
           offer_token_hash, offer_expires_at, eta_minutes, responded_at
         ) VALUES ($1,$2,$3,'manual','accepted',$4,$5,$6,now())
         RETURNING id`,
        [
          deliveryId,
          driverId,
          user.id,
          sha256(portalToken),
          expiresAt.toISOString(),
          del.eta_minutes,
        ],
      );

      const fromStatus = del.status;
      await client.query(
        `UPDATE delivery.deliveries
         SET status = 'assigned', updated_at = now()
         WHERE id = $1`,
        [deliveryId],
      );
      await client.query(
        `UPDATE delivery.drivers
         SET availability = 'on_delivery', updated_at = now() WHERE id = $1`,
        [driverId],
      );

      for (const prevId of previousDriverIds) {
        if (prevId === driverId) continue;
        const { rows: stillBusy } = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM delivery.driver_assignments
           WHERE driver_id = $1 AND status IN ('offered','accepted')`,
          [prevId],
        );
        if (Number(stillBusy[0]?.c ?? 0) === 0) {
          await client.query(
            `UPDATE delivery.drivers
             SET availability = 'available', updated_at = now()
             WHERE id = $1 AND availability = 'on_delivery'`,
            [prevId],
          );
        }
      }

      const { qrPlain, pinPlain } = await this.issueVerificationSecrets(
        client,
        deliveryId,
      );

      await client.query(
        `UPDATE sales.orders
         SET status = CASE
               WHEN status IN ('confirmed','processing','ready_for_dispatch') THEN 'dispatched'
               ELSE status
             END,
             updated_at = now()
         WHERE id = $1`,
        [del.order_id],
      );

      const reassigned = prior.length > 0;
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status, actor_id, note)
         VALUES ($1,$2,$3,'assigned',$4,$5)`,
        [
          deliveryId,
          reassigned ? 'reassigned' : 'assigned',
          fromStatus,
          user.id,
          `${reassigned ? 'Reassigned' : 'Assigned'} to ${driver.full_name} by admin`,
        ],
      );

      const trackLink = `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(del.order_number)}`;
      const customerText = [
        'Hello!',
        '',
        `Your Sabu Online Shopping order #${del.order_number} is on its way.`,
        '',
        `Driver: ${driver.full_name}`,
        `Call driver: ${driver.phone_e164 ?? '—'}`,
        `Estimated Arrival: ${del.eta_minutes ?? '—'} minutes`,
        '',
        'Please ensure that you or an authorized recipient is available.',
        `Tracking: ${trackLink}`,
        '',
        `Delivery PIN (if QR unavailable): ${pinPlain}`,
        `Show this QR token to the driver: ${qrPlain}`,
        '',
        'Thank you for choosing Sabu Online Shopping!',
      ].join('\n');

      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.customer_whatsapp', $2::jsonb)`,
        [
          deliveryId,
          JSON.stringify({
            preferredContactChannel: 'whatsapp',
            channel: 'whatsapp',
            phone: del.recipient_phone,
            recipientPhone: del.recipient_phone,
            text: customerText,
            orderNumber: del.order_number,
            orderId: del.order_id,
            pin: pinPlain,
            qrToken: qrPlain,
            trackingUrl: trackLink,
          }),
        ],
      );
      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.assigned', $2::jsonb)`,
        [
          deliveryId,
          JSON.stringify({
            deliveryId,
            assignmentId: assigns[0].id,
            driverId,
            assignedBy: user.id,
            reassigned,
          }),
        ],
      );

      await client.query('COMMIT');

      const dashboardUrl = `${this.webBase()}/driver/delivery?token=${encodeURIComponent(portalToken)}`;
      return {
        assignmentId: assigns[0].id,
        reassigned,
        driverPhone: driver.phone_e164,
        driverName: driver.full_name,
        deliveryStatus: 'assigned',
        dashboardUrl,
        customerNotified: true,
        qrIssued: Boolean(qrPlain),
        // Legacy shape for older admin clients
        offerToken: portalToken,
        offerLink: dashboardUrl,
        expiresAt,
        callScript: null,
        callUrl: null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getOfferByToken(token: string) {
    const { rows } = await this.db.query<{
      assignment_id: string;
      status: string;
      offer_expires_at: Date | null;
      eta_minutes: number | null;
      delivery_id: string;
      delivery_number: string;
      delivery_status: string;
      dropoff_address_text: string;
      dropoff_lng: string | null;
      dropoff_lat: string | null;
      recipient_name: string;
      package_count: number;
      distance_km: string | null;
      delivery_instructions: string | null;
      landmark_name: string | null;
      location_type: string | null;
      google_maps_url: string | null;
      recipient_phone: string;
      order_number: string;
      warehouse_name: string;
      warehouse_address: string | null;
      warehouse_lng: string | null;
      warehouse_lat: string | null;
      driver_name: string;
    }>(
      `SELECT a.id AS assignment_id, a.status, a.offer_expires_at, a.eta_minutes,
              d.id AS delivery_id, d.delivery_number, d.status AS delivery_status,
              d.dropoff_address_text,
              ST_X(d.dropoff_location::geometry)::text AS dropoff_lng,
              ST_Y(d.dropoff_location::geometry)::text AS dropoff_lat,
              d.recipient_name, d.recipient_phone, d.package_count, d.distance_km::text,
              d.delivery_instructions, d.landmark_name, d.location_type, d.google_maps_url,
              o.order_number,
              w.name AS warehouse_name, w.address_text AS warehouse_address,
              ST_X(w.location::geometry)::text AS warehouse_lng,
              ST_Y(w.location::geometry)::text AS warehouse_lat,
              u.full_name AS driver_name
       FROM delivery.driver_assignments a
       JOIN delivery.deliveries d ON d.id = a.delivery_id
       JOIN sales.orders o ON o.id = d.order_id
       JOIN inventory.warehouses w ON w.id = d.origin_warehouse_id
       JOIN delivery.drivers dr ON dr.id = a.driver_id
       JOIN iam.users u ON u.id = dr.user_id
       WHERE a.offer_token_hash = $1`,
      [sha256(token)],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Assignment not found');

    const expired =
      r.status === 'expired' ||
      (r.offer_expires_at != null && r.offer_expires_at.getTime() < Date.now());

    return {
      assignmentId: r.assignment_id,
      status: expired && r.status === 'offered' ? 'expired' : r.status,
      expired,
      expiresAt: r.offer_expires_at,
      orderNumber: r.order_number,
      deliveryNumber: r.delivery_number,
      deliveryId: r.delivery_id,
      packageCount: r.package_count,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      etaMinutes: r.eta_minutes,
      instructions: r.delivery_instructions,
      landmarkName: r.landmark_name,
      locationType: r.location_type,
      recipientPhone: r.recipient_phone,
      googleMapsUrl:
        r.google_maps_url ??
        (r.dropoff_lat != null && r.dropoff_lng != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${r.dropoff_lat},${r.dropoff_lng}`
          : null),
      driverName: r.driver_name,
      pickup: {
        name: r.warehouse_name,
        address: r.warehouse_address,
        lng: r.warehouse_lng != null ? Number(r.warehouse_lng) : null,
        lat: r.warehouse_lat != null ? Number(r.warehouse_lat) : null,
      },
      dropoff: {
        name: r.recipient_name,
        address: r.dropoff_address_text,
        lng: r.dropoff_lng != null ? Number(r.dropoff_lng) : null,
        lat: r.dropoff_lat != null ? Number(r.dropoff_lat) : null,
      },
    };
  }

  /**
   * Dynamic place search: Nominatim (OSM) biased to Addis Ababa / Ethiopia,
   * merged with local landmark quick-picks. No Google API key required.
   */
  async searchPlaces(q: string) {
    const query = q.trim();
    type PlaceHit = {
      id: string;
      name: string;
      area: string;
      city: string;
      placeId: string | null;
      category: string;
      lng: number;
      lat: number;
      source: 'landmark' | 'geocode';
      formattedAddress: string;
    };
    if (query.length < 2) return [] as PlaceHit[];

    // Local seeded landmarks first (always available on Railway even if
    // outbound geocoders are blocked).
    const local = await this.listLandmarks({ q: query, city: 'Addis Ababa' });
    const results: PlaceHit[] = local.slice(0, 6).map((r) => ({
      ...r,
      source: 'landmark' as const,
      formattedAddress: `${r.name}, ${r.area}, ${r.city}`,
    }));

    // Photon (Komoot) works more reliably from cloud hosts than Nominatim.
    let remote = await this.geocodeViaPhoton(query);
    if (!remote.length) {
      remote = await this.geocodeViaNominatim(query);
    }

    const seen = new Set(results.map((x) => x.formattedAddress.toLowerCase()));
    for (const r of remote) {
      const key = r.formattedAddress.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
      }
    }
    return results.slice(0, 12);
  }

  private async geocodeViaPhoton(query: string): Promise<
    Array<{
      id: string;
      name: string;
      area: string;
      city: string;
      placeId: string | null;
      category: string;
      lng: number;
      lat: number;
      source: 'geocode';
      formattedAddress: string;
    }>
  > {
    try {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', `${query}, Addis Ababa`);
      url.searchParams.set('lat', '9.03');
      url.searchParams.set('lon', '38.74');
      url.searchParams.set('limit', '8');
      url.searchParams.set('lang', 'en');
      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SabuEcommerce/1.0 (https://sabu.et; delivery search)',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`Photon geocode HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: {
            osm_id?: number;
            osm_type?: string;
            name?: string;
            street?: string;
            district?: string;
            suburb?: string;
            city?: string;
            state?: string;
            country?: string;
            countrycode?: string;
            type?: string;
            housenumber?: string;
          };
        }>;
      };
      return (data.features ?? [])
        .map((f) => {
          const p = f.properties ?? {};
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const [lng, lat] = coords;
          const cc = (p.countrycode ?? '').toLowerCase();
          if (cc && cc !== 'et') return null;
          const name =
            p.name ||
            [p.street, p.housenumber].filter(Boolean).join(' ') ||
            query;
          const area = p.district || p.suburb || p.city || 'Addis Ababa';
          const city = p.city || p.state || 'Addis Ababa';
          const formatted = [name, area, city, p.country || 'Ethiopia']
            .filter(Boolean)
            .join(', ');
          return {
            id: `photon-${p.osm_type ?? 'n'}-${p.osm_id ?? `${lng},${lat}`}`,
            name,
            area,
            city,
            placeId: p.osm_id
              ? `photon:${p.osm_type ?? 'n'}:${p.osm_id}`
              : null,
            category: p.type || 'place',
            lng,
            lat,
            source: 'geocode' as const,
            formattedAddress: formatted,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
    } catch (err) {
      this.logger.warn(
        `Photon geocode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async geocodeViaNominatim(query: string): Promise<
    Array<{
      id: string;
      name: string;
      area: string;
      city: string;
      placeId: string | null;
      category: string;
      lng: number;
      lat: number;
      source: 'geocode';
      formattedAddress: string;
    }>
  > {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', `${query}, Addis Ababa, Ethiopia`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '8');
      url.searchParams.set('countrycodes', 'et');
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent':
            'SabuEcommerce/1.0 (https://sabu.et; checkout delivery search)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`Nominatim geocode HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
        type?: string;
        class?: string;
        address?: Record<string, string>;
      }>;
      return data.map((d) => {
        const addr = d.address ?? {};
        const area =
          addr.suburb ||
          addr.neighbourhood ||
          addr.city_district ||
          addr.town ||
          'Addis Ababa';
        const name =
          addr.amenity ||
          addr.shop ||
          addr.building ||
          addr.road ||
          d.display_name.split(',')[0] ||
          query;
        return {
          id: `osm-${d.place_id}`,
          name,
          area,
          city: addr.city || addr.state || 'Addis Ababa',
          placeId: `nominatim:${d.place_id}`,
          category: d.type || d.class || 'place',
          lng: Number(d.lon),
          lat: Number(d.lat),
          source: 'geocode' as const,
          formattedAddress: d.display_name,
        };
      });
    } catch (err) {
      this.logger.warn(
        `Nominatim geocode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async listLandmarks(opts?: { q?: string; city?: string }) {
    const params: unknown[] = [];
    const where = [`is_active = true`];
    if (opts?.city) {
      params.push(opts.city);
      where.push(`city ILIKE $${params.length}`);
    }
    if (opts?.q) {
      params.push(`%${opts.q}%`);
      where.push(
        `(name ILIKE $${params.length} OR area ILIKE $${params.length})`,
      );
    }
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      area: string;
      city: string;
      place_id: string | null;
      category: string;
      lng: string;
      lat: string;
    }>(
      `SELECT id, name, area, city, place_id, category,
              ST_X(location::geometry)::text AS lng,
              ST_Y(location::geometry)::text AS lat
       FROM delivery.landmarks
       WHERE ${where.join(' AND ')}
       ORDER BY sort_order, name
       LIMIT 50`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area,
      city: r.city,
      placeId: r.place_id,
      category: r.category,
      lng: Number(r.lng),
      lat: Number(r.lat),
    }));
  }

  async acceptOffer(token: string) {
    // Manual admin assignment only — drivers no longer accept/decline in-app.
    const existing = await this.getOfferByToken(token).catch(() => null);
    if (existing?.status === 'accepted') {
      return {
        ok: true,
        deliveryId: existing.deliveryId,
        assignmentToken: token,
        dashboardUrl: `${this.webBase()}/driver/delivery?token=${encodeURIComponent(token)}`,
        customerNotified: false,
        qrIssued: false,
        alreadyAssigned: true,
      };
    }
    throw new BadRequestException(
      'Driver accept/decline is disabled. An administrator assigns deliveries after contacting the driver by phone.',
    );
  }

  async declineOffer(_token: string, _reason?: string) {
    throw new BadRequestException(
      'Driver accept/decline is disabled. An administrator assigns or reassigns deliveries after contacting the driver by phone.',
    );
  }

  async getDriverDashboard(token: string) {
    const offer = await this.getOfferByToken(token);
    if (offer.status !== 'accepted' && offer.status !== 'completed') {
      throw new BadRequestException('Assignment not active');
    }
    const deliveryStatus =
      (
        await this.db.query<{ status: string }>(
          `SELECT status FROM delivery.deliveries WHERE id = $1`,
          [offer.deliveryId],
        )
      ).rows[0]?.status ?? '';
    if (
      !['assigned', 'accepted', 'picked_up', 'in_transit', 'arrived'].includes(
        deliveryStatus,
      ) &&
      offer.status !== 'completed'
    ) {
      throw new BadRequestException('Delivery is not active for this driver');
    }

    const { rows: items } = await this.db.query<{
      name_snapshot: string;
      quantity: number;
      sku_snapshot: string | null;
    }>(
      `SELECT oi.name_snapshot, di.quantity, oi.sku_snapshot
       FROM delivery.delivery_items di
       JOIN sales.order_items oi ON oi.id = di.order_item_id
       WHERE di.delivery_id = $1`,
      [offer.deliveryId],
    );

    const { rows: del } = await this.db.query<{
      status: string;
      verified_at: Date | null;
    }>(
      `SELECT status, verified_at FROM delivery.deliveries WHERE id = $1`,
      [offer.deliveryId],
    );

    return {
      ...offer,
      deliveryStatus: del[0]?.status,
      verified: Boolean(del[0]?.verified_at),
      items: items.map((i) => ({
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
      })),
    };
  }

  async verifyWithQr(token: string, qrToken: string) {
    return this.verifyDelivery(token, { qrToken });
  }

  async verifyWithPin(token: string, pin: string) {
    return this.verifyDelivery(token, { pin });
  }

  async confirmDelivery(token: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const assignment = await this.lockAcceptedAssignment(client, token);
      const { rows: dels } = await client.query<{
        id: string;
        status: string;
        verified_at: Date | null;
        verified_method: string | null;
        order_id: string;
        driver_id: string;
      }>(
        `SELECT d.id, d.status, d.verified_at, d.verified_method, d.order_id, a.driver_id
         FROM delivery.deliveries d
         JOIN delivery.driver_assignments a ON a.delivery_id = d.id AND a.id = $2
         WHERE d.id = $1 FOR UPDATE OF d`,
        [assignment.delivery_id, assignment.id],
      );
      const del = dels[0];
      if (!del) throw new NotFoundException('Delivery not found');
      if (del.status === 'delivered') {
        throw new ConflictException('Already delivered');
      }
      if (!del.verified_at) {
        throw new BadRequestException('Verify QR or PIN before confirming');
      }

      await client.query(
        `UPDATE delivery.deliveries
         SET status = 'delivered', delivered_at = now(), updated_at = now()
         WHERE id = $1`,
        [del.id],
      );
      await client.query(
        `INSERT INTO delivery.proof_of_delivery (delivery_id, method, otp_verified, received_by_name)
         VALUES ($1, $2, true, 'Customer')
         ON CONFLICT (delivery_id) DO UPDATE
           SET method = EXCLUDED.method, otp_verified = true, captured_at = now()`,
        [del.id, del.verified_method === 'qr' ? 'qr' : 'pin'],
      );
      await client.query(
        `UPDATE delivery.driver_assignments
         SET status = 'completed', completed_at = now() WHERE id = $1`,
        [assignment.id],
      );
      await client.query(
        `UPDATE delivery.drivers
         SET availability = 'available', updated_at = now() WHERE id = $1`,
        [del.driver_id],
      );
      await client.query(
        `UPDATE sales.orders
         SET status = 'delivered', updated_at = now() WHERE id = $1`,
        [del.order_id],
      );
      await client.query(
        `INSERT INTO sales.order_status_history (order_id, from_status, to_status, reason)
         VALUES ($1, 'dispatched', 'delivered', 'Driver confirmed PoD')`,
        [del.order_id],
      );
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status)
         VALUES ($1,'delivered',$2,'delivered')`,
        [del.id, del.status],
      );
      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.completed', $2::jsonb)`,
        [del.id, JSON.stringify({ deliveryId: del.id, orderId: del.order_id })],
      );
      await client.query('COMMIT');
      return { ok: true, status: 'delivered' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Customer track page: delivery status + QR/PIN while unverified. */
  async getCustomerDeliveryArtifacts(orderNumber: string, trackToken: string) {
    const { rows } = await this.db.query<{
      delivery_number: string;
      status: string;
      driver_name: string | null;
      driver_phone: string | null;
      eta_minutes: number | null;
      verified_at: Date | null;
      qr_token_plain: string | null;
      pin_plain: string | null;
    }>(
      `SELECT d.delivery_number, d.status,
              u.full_name AS driver_name, u.phone_e164 AS driver_phone,
              d.eta_minutes, d.verified_at, d.qr_token_plain, d.pin_plain
       FROM sales.orders o
       JOIN delivery.deliveries d ON d.order_id = o.id
       LEFT JOIN delivery.driver_assignments a
         ON a.delivery_id = d.id AND a.status IN ('accepted','completed')
       LEFT JOIN delivery.drivers dr ON dr.id = a.driver_id
       LEFT JOIN iam.users u ON u.id = dr.user_id
       WHERE o.order_number = $1 AND o.guest_track_token_hash = $2
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [orderNumber, sha256(trackToken)],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      deliveryNumber: r.delivery_number,
      status: r.status,
      driverName: r.driver_name,
      driverPhone: r.driver_phone,
      etaMinutes: r.eta_minutes,
      verified: Boolean(r.verified_at),
      qrToken: r.verified_at ? null : r.qr_token_plain,
      pin: r.verified_at ? null : r.pin_plain,
    };
  }

  /**
   * Admin helper: regenerate customer QR/PIN plaintext for support (logged).
   */
  async reissueVerification(user: AuthUser, deliveryId: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const secrets = await this.issueVerificationSecrets(client, deliveryId);
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, note, actor_id)
         VALUES ($1,'verification_reissued','Admin reissued QR/PIN',$2)`,
        [deliveryId, user.id],
      );
      await client.query('COMMIT');
      return {
        qrToken: secrets.qrPlain,
        pin: secrets.pinPlain,
        expiresAt: secrets.expiresAt,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async verifyDelivery(
    assignmentToken: string,
    input: { qrToken?: string; pin?: string },
  ) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const assignment = await this.lockAcceptedAssignment(
        client,
        assignmentToken,
      );
      const { rows } = await client.query<{
        id: string;
        status: string;
        qr_token_hash: Buffer | null;
        pin_hash: Buffer | null;
        verification_expires_at: Date | null;
        verified_at: Date | null;
      }>(
        `SELECT id, status, qr_token_hash, pin_hash, verification_expires_at, verified_at
         FROM delivery.deliveries WHERE id = $1 FOR UPDATE`,
        [assignment.delivery_id],
      );
      const del = rows[0];
      if (!del) throw new NotFoundException('Delivery not found');
      if (del.status === 'delivered') {
        throw new ConflictException('Already delivered');
      }
      if (del.verified_at) {
        await client.query('COMMIT');
        return { ok: true, alreadyVerified: true };
      }
      if (
        del.verification_expires_at &&
        del.verification_expires_at.getTime() < Date.now()
      ) {
        throw new BadRequestException('Verification code expired — ask admin to reissue');
      }

      let method: 'qr' | 'pin';
      if (input.qrToken) {
        if (
          !del.qr_token_hash ||
          !timingSafeEqualHash(del.qr_token_hash, sha256(input.qrToken))
        ) {
          throw new BadRequestException('Invalid QR code');
        }
        method = 'qr';
      } else if (input.pin) {
        if (
          !del.pin_hash ||
          !timingSafeEqualHash(del.pin_hash, sha256(input.pin))
        ) {
          throw new BadRequestException('Invalid PIN');
        }
        method = 'pin';
      } else {
        throw new BadRequestException('QR token or PIN required');
      }

      await client.query(
        `UPDATE delivery.deliveries
         SET verified_at = now(), verified_method = $2, status = 'arrived', updated_at = now()
         WHERE id = $1`,
        [del.id, method],
      );
      // One-time: clear secrets after successful verify (anti-replay)
      await client.query(
        `UPDATE delivery.deliveries
         SET qr_token_hash = NULL, pin_hash = NULL,
             qr_token_plain = NULL, pin_plain = NULL
         WHERE id = $1`,
        [del.id],
      );
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status, note)
         VALUES ($1,'verified',$2,'arrived',$3)`,
        [del.id, del.status, `Verified via ${method}`],
      );
      await client.query('COMMIT');

      const { rows: items } = await this.db.query<{
        name_snapshot: string;
        quantity: number;
      }>(
        `SELECT oi.name_snapshot, di.quantity
         FROM delivery.delivery_items di
         JOIN sales.order_items oi ON oi.id = di.order_item_id
         WHERE di.delivery_id = $1`,
        [del.id],
      );
      return {
        ok: true,
        method,
        items: items.map((i) => ({
          name: i.name_snapshot,
          quantity: i.quantity,
        })),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async lockAcceptedAssignment(client: PoolClient, token: string) {
    const { rows } = await client.query<{
      id: string;
      status: string;
      delivery_id: string;
      driver_id: string;
    }>(
      `SELECT id, status, delivery_id, driver_id
       FROM delivery.driver_assignments
       WHERE offer_token_hash = $1 FOR UPDATE`,
      [sha256(token)],
    );
    const a = rows[0];
    if (!a) throw new NotFoundException('Assignment not found');
    if (a.status !== 'accepted') {
      throw new BadRequestException('Assignment is not active');
    }
    return a;
  }

  private async issueVerificationSecrets(client: PoolClient, deliveryId: string) {
    const qrPlain = randomBytes(18).toString('base64url');
    const pinPlain = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await client.query(
      `UPDATE delivery.deliveries SET
         qr_token_hash = $2,
         pin_hash = $3,
         qr_token_plain = $4,
         pin_plain = $5,
         verification_expires_at = $6,
         verified_at = NULL,
         verified_method = NULL,
         updated_at = now()
       WHERE id = $1`,
      [
        deliveryId,
        sha256(qrPlain),
        sha256(pinPlain),
        qrPlain,
        pinPlain,
        expiresAt.toISOString(),
      ],
    );
    return { qrPlain, pinPlain, expiresAt };
  }

  private async loadDeliveryDetail(deliveryId: string) {
    const { rows } = await this.db.query<{
      id: string;
      delivery_number: string;
      status: string;
      order_id: string;
      order_number: string;
      dropoff_address_text: string;
      recipient_name: string;
      recipient_phone: string;
      distance_km: string | null;
      eta_minutes: number | null;
      package_count: number;
      warehouse_name: string;
      lng: string | null;
      lat: string | null;
      delivery_instructions: string | null;
      landmark_name: string | null;
      location_type: string | null;
      google_maps_url: string | null;
      delivery_service_type: string | null;
      preferred_contact_channel: string | null;
      assigned_driver_id: string | null;
      assigned_driver_name: string | null;
      assigned_driver_phone: string | null;
      assigned_driver_code: string | null;
      assignment_status: string | null;
    }>(
      `SELECT d.id, d.delivery_number, d.status, o.id AS order_id, o.order_number,
              d.dropoff_address_text, d.recipient_name, d.recipient_phone,
              d.distance_km::text, d.eta_minutes, d.package_count, w.name AS warehouse_name,
              ST_X(d.dropoff_location::geometry)::text AS lng,
              ST_Y(d.dropoff_location::geometry)::text AS lat,
              d.delivery_instructions, d.landmark_name, d.location_type, d.google_maps_url,
              o.delivery_service_type, o.preferred_contact_channel,
              a.driver_id AS assigned_driver_id,
              du.full_name AS assigned_driver_name,
              du.phone_e164 AS assigned_driver_phone,
              adr.driver_code AS assigned_driver_code,
              a.status AS assignment_status
       FROM delivery.deliveries d
       JOIN sales.orders o ON o.id = d.order_id
       JOIN inventory.warehouses w ON w.id = d.origin_warehouse_id
       LEFT JOIN LATERAL (
         SELECT driver_id, status
         FROM delivery.driver_assignments
         WHERE delivery_id = d.id AND status IN ('offered','accepted')
         ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, offered_at DESC
         LIMIT 1
       ) a ON true
       LEFT JOIN delivery.drivers adr ON adr.id = a.driver_id
       LEFT JOIN iam.users du ON du.id = adr.user_id
       WHERE d.id = $1`,
      [deliveryId],
    );
    if (!rows[0]) throw new NotFoundException('Delivery not found');
    const r = rows[0];
    const { rows: items } = await this.db.query<{
      name_snapshot: string;
      quantity: number;
      sku_snapshot: string | null;
    }>(
      `SELECT oi.name_snapshot, di.quantity, oi.sku_snapshot
       FROM delivery.delivery_items di
       JOIN sales.order_items oi ON oi.id = di.order_item_id
       WHERE di.delivery_id = $1`,
      [deliveryId],
    );
    const mapsUrl =
      r.google_maps_url ||
      (r.lat != null && r.lng != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`
        : null);
    const serviceType = r.delivery_service_type === 'express' ? 'Express' : 'Standard';
    return {
      id: r.id,
      deliveryNumber: r.delivery_number,
      status: r.status,
      orderId: r.order_id,
      orderNumber: r.order_number,
      address: r.dropoff_address_text,
      recipientName: r.recipient_name,
      recipientPhone: r.recipient_phone,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      etaMinutes: r.eta_minutes,
      packageCount: r.package_count,
      warehouseName: r.warehouse_name,
      lng: r.lng != null ? Number(r.lng) : null,
      lat: r.lat != null ? Number(r.lat) : null,
      deliveryInstructions: r.delivery_instructions,
      landmarkName: r.landmark_name,
      locationType: r.location_type,
      googleMapsUrl: mapsUrl,
      serviceType,
      serviceTypeCode: r.delivery_service_type ?? 'standard',
      preferredContactChannel: r.preferred_contact_channel,
      assignedDriver: r.assigned_driver_id
        ? {
            id: r.assigned_driver_id,
            name: r.assigned_driver_name,
            phone: r.assigned_driver_phone,
            code: r.assigned_driver_code,
            assignmentStatus: r.assignment_status,
          }
        : null,
      items: items.map((i) => ({
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        quantity: i.quantity,
      })),
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

function timingSafeEqualHash(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

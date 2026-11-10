import {
  BadRequestException,
  ConflictException,
  Injectable,
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
    }>(`SELECT offer_ttl_minutes, default_speed_kmh::text FROM delivery.dispatch_settings WHERE id = 1`);
    return {
      offerTtlMinutes: rows[0]?.offer_ttl_minutes ?? 15,
      defaultSpeedKmh: Number(rows[0]?.default_speed_kmh ?? 25),
    };
  }

  async updateSettings(input: {
    offerTtlMinutes?: number;
    defaultSpeedKmh?: number;
  }) {
    await this.db.query(
      `UPDATE delivery.dispatch_settings SET
         offer_ttl_minutes = COALESCE($1, offer_ttl_minutes),
         default_speed_kmh = COALESCE($2, default_speed_kmh),
         updated_at = now()
       WHERE id = 1`,
      [input.offerTtlMinutes ?? null, input.defaultSpeedKmh ?? null],
    );
    return this.getSettings();
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
    const { rows: offers } = await this.db.query<{
      id: string;
      status: string;
      driver_name: string;
      driver_code: string;
      offered_at: Date;
      responded_at: Date | null;
      offer_expires_at: Date | null;
    }>(
      `SELECT a.id, a.status, u.full_name AS driver_name, dr.driver_code,
              a.offered_at, a.responded_at, a.offer_expires_at
       FROM delivery.driver_assignments a
       JOIN delivery.drivers dr ON dr.id = a.driver_id
       JOIN iam.users u ON u.id = dr.user_id
       WHERE a.delivery_id = $1
       ORDER BY a.offered_at DESC`,
      [deliveryId],
    );
    return {
      ...base,
      offers: offers.map((o) => ({
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
      }>(
        `SELECT id, order_number, status, payment_status,
                ship_recipient_name, ship_recipient_phone, ship_address_text,
                fulfillment_warehouse_id
         FROM sales.orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = orders[0];
      if (!order) throw new NotFoundException('Order not found');
      if (order.payment_status !== 'paid') {
        throw new BadRequestException('Order must be paid before dispatch');
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

      const { rows: dels } = await client.query<{ id: string }>(
        `INSERT INTO delivery.deliveries (
           delivery_number, order_id, origin_warehouse_id, zone_id,
           dropoff_location, dropoff_address_text, recipient_name, recipient_phone,
           distance_km, status, package_count, eta_minutes
         ) VALUES (
           $1,$2,$3,$4,
           (SELECT ship_location FROM sales.orders WHERE id = $2),
           $5,$6,$7,$8,'pending_assignment',$9,$10
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

  async offerToDriver(
    user: AuthUser,
    deliveryId: string,
    driverId: string,
  ) {
    const settings = await this.getSettings();
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
        order_number: string;
        warehouse_name: string;
      }>(
        `SELECT d.id, d.status, d.delivery_number, d.dropoff_address_text,
                d.distance_km::text, d.eta_minutes, o.order_number, w.name AS warehouse_name
         FROM delivery.deliveries d
         JOIN sales.orders o ON o.id = d.order_id
         JOIN inventory.warehouses w ON w.id = d.origin_warehouse_id
         WHERE d.id = $1 FOR UPDATE OF d`,
        [deliveryId],
      );
      const del = dels[0];
      if (!del) throw new NotFoundException('Delivery not found');
      if (['delivered', 'cancelled', 'returned_to_warehouse'].includes(del.status)) {
        throw new BadRequestException(`Cannot assign delivery in status=${del.status}`);
      }

      // Expire any live offers
      await client.query(
        `UPDATE delivery.driver_assignments
         SET status = 'expired', responded_at = now()
         WHERE delivery_id = $1 AND status = 'offered'`,
        [deliveryId],
      );

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

      const offerToken = randomBytes(24).toString('base64url');
      const expiresAt = new Date(
        Date.now() + settings.offerTtlMinutes * 60_000,
      );

      const { rows: assigns } = await client.query<{ id: string }>(
        `INSERT INTO delivery.driver_assignments (
           delivery_id, driver_id, assigned_by, assignment_method, status,
           offer_token_hash, offer_expires_at, eta_minutes
         ) VALUES ($1,$2,$3,'manual','offered',$4,$5,$6)
         RETURNING id`,
        [
          deliveryId,
          driverId,
          user.id,
          sha256(offerToken),
          expiresAt.toISOString(),
          del.eta_minutes,
        ],
      );

      await client.query(
        `UPDATE delivery.deliveries
         SET status = 'assigned', updated_at = now()
         WHERE id = $1`,
        [deliveryId],
      );
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status, actor_id, note)
         VALUES ($1,'offered',$2,'assigned',$3,$4)`,
        [
          deliveryId,
          del.status,
          user.id,
          `Offered to ${driver.full_name}`,
        ],
      );

      const link = `${this.webBase()}/driver/offer?token=${encodeURIComponent(offerToken)}`;
      const whatsappText = [
        `Hello ${driver.full_name.split(' ')[0]},`,
        '',
        'You have a new delivery request from Sabu Online Shopping.',
        '',
        `Order: #${del.order_number}`,
        `Pickup: ${del.warehouse_name}`,
        `Destination: ${del.dropoff_address_text}`,
        `Estimated Distance: ${del.distance_km ?? '—'} km`,
        `Estimated Delivery Time: ${del.eta_minutes ?? '—'} minutes`,
        '',
        'Please open the secure link below to review and accept or decline:',
        link,
      ].join('\n');

      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.offer_whatsapp', $2::jsonb)`,
        [
          assigns[0].id,
          JSON.stringify({
            channel: 'whatsapp',
            to: driver.phone_e164,
            text: whatsappText,
            assignmentId: assigns[0].id,
            deliveryId,
            offerLink: link,
          }),
        ],
      );

      await client.query('COMMIT');
      return {
        assignmentId: assigns[0].id,
        offerToken,
        offerLink: link,
        expiresAt,
        whatsappPreview: whatsappText,
        driverPhone: driver.phone_e164,
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
              d.recipient_name, d.package_count, d.distance_km::text,
              d.delivery_instructions, o.order_number,
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

  async acceptOffer(token: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        status: string;
        delivery_id: string;
        driver_id: string;
        offer_expires_at: Date | null;
        eta_minutes: number | null;
      }>(
        `SELECT id, status, delivery_id, driver_id, offer_expires_at, eta_minutes
         FROM delivery.driver_assignments
         WHERE offer_token_hash = $1 FOR UPDATE`,
        [sha256(token)],
      );
      const offer = rows[0];
      if (!offer) throw new NotFoundException('Assignment not found');
      if (offer.status !== 'offered') {
        throw new ConflictException(`Offer already ${offer.status}`);
      }
      if (
        offer.offer_expires_at &&
        offer.offer_expires_at.getTime() < Date.now()
      ) {
        await client.query(
          `UPDATE delivery.driver_assignments SET status = 'expired', responded_at = now() WHERE id = $1`,
          [offer.id],
        );
        await client.query('COMMIT');
        throw new BadRequestException('Offer has expired');
      }

      // Ensure no other accepted assignment
      const { rows: live } = await client.query<{ id: string }>(
        `SELECT id FROM delivery.driver_assignments
         WHERE delivery_id = $1 AND status = 'accepted' AND id <> $2`,
        [offer.delivery_id, offer.id],
      );
      if (live[0]) throw new ConflictException('Delivery already accepted');

      await client.query(
        `UPDATE delivery.driver_assignments
         SET status = 'accepted', responded_at = now() WHERE id = $1`,
        [offer.id],
      );
      await client.query(
        `UPDATE delivery.driver_assignments
         SET status = 'cancelled', responded_at = now()
         WHERE delivery_id = $1 AND status = 'offered' AND id <> $2`,
        [offer.delivery_id, offer.id],
      );
      await client.query(
        `UPDATE delivery.deliveries
         SET status = 'accepted', updated_at = now() WHERE id = $1`,
        [offer.delivery_id],
      );
      await client.query(
        `UPDATE delivery.drivers
         SET availability = 'on_delivery', updated_at = now() WHERE id = $1`,
        [offer.driver_id],
      );

      const { qrPlain, pinPlain } = await this.issueVerificationSecrets(
        client,
        offer.delivery_id,
      );

      const { rows: meta } = await client.query<{
        order_id: string;
        order_number: string;
        recipient_phone: string;
        recipient_name: string;
        driver_name: string;
        driver_phone: string | null;
        eta_minutes: number | null;
      }>(
        `SELECT o.id AS order_id, o.order_number, d.recipient_phone, d.recipient_name,
                u.full_name AS driver_name, u.phone_e164 AS driver_phone, d.eta_minutes
         FROM delivery.deliveries d
         JOIN sales.orders o ON o.id = d.order_id
         JOIN delivery.drivers dr ON dr.id = $2
         JOIN iam.users u ON u.id = dr.user_id
         WHERE d.id = $1`,
        [offer.delivery_id, offer.driver_id],
      );
      const m = meta[0];

      await client.query(
        `UPDATE sales.orders
         SET status = CASE
               WHEN status IN ('confirmed','processing','ready_for_dispatch') THEN 'dispatched'
               ELSE status
             END,
             updated_at = now()
         WHERE id = $1`,
        [m.order_id],
      );

      const trackTokenRow = await client.query<{ guest_track_token_hash: Buffer | null }>(
        `SELECT guest_track_token_hash FROM sales.orders WHERE id = $1`,
        [m.order_id],
      );
      // Customer WhatsApp notification (stub via outbox)
      // Token is included when available on the assignment/customer payload;
      // otherwise the customer recovers via order # + phone on the track page.
      const trackToken =
        typeof (m as { track_token?: string }).track_token === 'string'
          ? (m as { track_token?: string }).track_token
          : null;
      const trackLink = trackToken
        ? `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(m.order_number)}&token=${encodeURIComponent(trackToken)}`
        : `${this.webBase()}/orders/track?orderNumber=${encodeURIComponent(m.order_number)}`;
      const customerText = [
        'Hello!',
        '',
        `Your Sabu Online Shopping order #${m.order_number} is on its way.`,
        '',
        `Driver: ${m.driver_name}`,
        `Phone/WhatsApp: ${m.driver_phone ?? '—'}`,
        `Estimated Arrival: ${m.eta_minutes ?? offer.eta_minutes ?? '—'} minutes`,
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
          offer.delivery_id,
          JSON.stringify({
            channel: 'whatsapp',
            to: m.recipient_phone,
            text: customerText,
            orderNumber: m.order_number,
            pin: pinPlain,
            qrToken: qrPlain,
          }),
        ],
      );
      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.accepted', $2::jsonb)`,
        [
          offer.delivery_id,
          JSON.stringify({
            deliveryId: offer.delivery_id,
            assignmentId: offer.id,
            driverId: offer.driver_id,
          }),
        ],
      );
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status, note)
         VALUES ($1,'accepted','assigned','accepted','Driver accepted offer')`,
        [offer.delivery_id],
      );

      await client.query('COMMIT');
      void trackTokenRow;

      return {
        ok: true,
        deliveryId: offer.delivery_id,
        assignmentToken: token,
        dashboardUrl: `${this.webBase()}/driver/delivery?token=${encodeURIComponent(token)}`,
        // QR/PIN returned only to server logs via notify; customer gets WhatsApp
        customerNotified: true,
        qrIssued: Boolean(qrPlain),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async declineOffer(token: string, reason?: string) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        status: string;
        delivery_id: string;
      }>(
        `SELECT id, status, delivery_id FROM delivery.driver_assignments
         WHERE offer_token_hash = $1 FOR UPDATE`,
        [sha256(token)],
      );
      const offer = rows[0];
      if (!offer) throw new NotFoundException('Assignment not found');
      if (offer.status !== 'offered') {
        throw new ConflictException(`Offer already ${offer.status}`);
      }
      await client.query(
        `UPDATE delivery.driver_assignments
         SET status = 'rejected', reject_reason = $2, responded_at = now()
         WHERE id = $1`,
        [offer.id, reason ?? null],
      );
      await client.query(
        `UPDATE delivery.deliveries
         SET status = 'pending_assignment', updated_at = now()
         WHERE id = $1`,
        [offer.delivery_id],
      );
      await client.query(
        `INSERT INTO delivery.delivery_events (delivery_id, event_type, from_status, to_status, note)
         VALUES ($1,'declined','assigned','pending_assignment',$2)`,
        [offer.delivery_id, reason ?? 'Driver declined'],
      );
      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('delivery', $1, 'delivery.offer_declined', $2::jsonb)`,
        [
          offer.delivery_id,
          JSON.stringify({ assignmentId: offer.id, reason }),
        ],
      );
      await client.query('COMMIT');
      return { ok: true, reassignable: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getDriverDashboard(token: string) {
    const offer = await this.getOfferByToken(token);
    if (offer.status !== 'accepted' && offer.status !== 'completed') {
      // Allow in-progress delivery statuses via delivery table
      if (!['accepted', 'picked_up', 'in_transit', 'arrived'].includes(
        // re-fetch delivery status
        (
          await this.db.query<{ status: string }>(
            `SELECT status FROM delivery.deliveries WHERE id = $1`,
            [offer.deliveryId],
          )
        ).rows[0]?.status ?? '',
      )) {
        if (offer.status !== 'accepted') {
          throw new BadRequestException('Assignment not active');
        }
      }
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
    }>(
      `SELECT d.id, d.delivery_number, d.status, o.id AS order_id, o.order_number,
              d.dropoff_address_text, d.recipient_name, d.recipient_phone,
              d.distance_km::text, d.eta_minutes, d.package_count, w.name AS warehouse_name,
              ST_X(d.dropoff_location::geometry)::text AS lng,
              ST_Y(d.dropoff_location::geometry)::text AS lat
       FROM delivery.deliveries d
       JOIN sales.orders o ON o.id = d.order_id
       JOIN inventory.warehouses w ON w.id = d.origin_warehouse_id
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

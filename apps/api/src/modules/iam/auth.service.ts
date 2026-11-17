import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import {
  generateOtpCode,
  generateRefreshToken,
  sha256,
} from '../../common/crypto.util';
import {
  AccessTokenPayload,
  AuthUser,
  ClientType,
  UserType,
} from './auth.types';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  OtpDeliveryService,
  TWILIO_VERIFY_MARKER,
} from '../notify/otp-delivery.service';

type UserRow = {
  id: string;
  user_type: UserType;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  status: string;
  locked_until: Date | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly otpDelivery: OtpDeliveryService,
  ) {}

  async requestOtp(dto: RequestOtpDto, ip?: string) {
    const phone = dto.phone;
    const purpose = dto.purpose ?? 'login';
    const clientType = dto.clientType ?? 'web';
    const isAdminClient = clientType === 'admin_web';
    const isProduction = this.config.get('NODE_ENV') === 'production';

    if (isAdminClient) {
      this.assertAdminPhoneAllowlisted(phone);
    }

    let user = await this.findUserByPhone(phone);

    if (!user && purpose === 'login') {
      if (isAdminClient) {
        user = await this.registerStaffAdmin(
          phone,
          dto.fullName ?? 'Sabu Admin',
        );
      } else {
        user = await this.registerCustomer(
          phone,
          dto.fullName ?? 'Sabu Customer',
        );
      }
    }

    if (!user) {
      throw new BadRequestException('No account found for this phone');
    }

    if (isAdminClient) {
      // Allowlisted phones only — ensure staff + ops admin role.
      user = await this.ensureAllowlistedStaffAdmin(user, dto.fullName);
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    if (user.status === 'suspended' || user.status === 'deactivated') {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    const code = generateOtpCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Never log plaintext OTP in production. Dev may return it only when explicitly enabled.
    if (!isProduction) {
      this.logger.log(
        `OTP for ${phone}: ${code} (expires ${expiresAt.toISOString()}) ip=${ip ?? '-'}`,
      );
    } else {
      this.logger.log(
        `OTP issued for ${phone.slice(0, 4)}*** (expires ${expiresAt.toISOString()}) ip=${ip ?? '-'}`,
      );
    }

    const delivery = await this.otpDelivery.deliverOtp(phone, code);
    // Temporary: show code on login UI when AUTH_DEV_RETURN_OTP=true
    // (e.g. until Ethiopia WhatsApp is configured). Never for Twilio Verify
    // codes — those are only in the SMS.
    const showOnScreen =
      this.config.get('AUTH_DEV_RETURN_OTP') === 'true' &&
      !delivery.providerManagedCode;

    // In production without a working channel, fail — unless on-screen OTP is enabled.
    if (
      isProduction &&
      !delivery.ok &&
      delivery.status !== 'pending_click' &&
      !showOnScreen
    ) {
      const twilioHint = delivery.error?.includes('template')
        ? ' Twilio trial requires Verify — set TWILIO_VERIFY_SERVICE_SID.'
        : '';
      throw new BadRequestException(
        delivery.channel === 'sms'
          ? `Could not send SMS code. Check Twilio configuration.${twilioHint}`
          : 'Could not send WhatsApp code. Check WhatsApp Cloud API / OTP template.',
      );
    }

    // Twilio Verify generates its own code — store a marker instead of our hash.
    const codeHash = delivery.providerManagedCode
      ? sha256(TWILIO_VERIFY_MARKER)
      : sha256(code);

    await this.db.query(
      `INSERT INTO iam.otp_challenges (user_id, destination, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, phone, purpose, codeHash, expiresAt],
    );

    if (showOnScreen && isProduction) {
      this.logger.warn(
        `AUTH_DEV_RETURN_OTP=true — returning OTP in API response for ${phone.slice(0, 4)}*** (temporary)`,
      );
    }

    return {
      ok: true,
      expiresAt: expiresAt.toISOString(),
      channel: showOnScreen ? 'dev' : delivery.channel,
      deliveryStatus: showOnScreen ? 'on_screen' : delivery.status,
      ...(delivery.deepLink && !delivery.ok
        ? { whatsappDeepLink: delivery.deepLink }
        : {}),
      ...(showOnScreen ? { devCode: code } : {}),
    };
  }

  async verifyOtp(dto: VerifyOtpDto, ip?: string, userAgent?: string) {
    const phone = dto.phone;
    const clientType = dto.clientType ?? 'web';

    const user = await this.findUserByPhone(phone);
    if (!user) throw new UnauthorizedException('Invalid phone or code');

    if (clientType === 'admin_web') {
      this.assertAdminPhoneAllowlisted(phone);
      await this.assertExistingStaffAdmin(user);
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<{
        id: string;
        code_hash: Buffer;
        attempts: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, code_hash, attempts, expires_at, consumed_at
         FROM iam.otp_challenges
         WHERE destination = $1 AND purpose IN ('login','verify_phone')
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [phone],
      );

      const challenge = locked.rows[0];
      if (!challenge) {
        throw new UnauthorizedException('No active OTP. Request a new code.');
      }
      if (challenge.expires_at < new Date()) {
        throw new UnauthorizedException('OTP expired. Request a new code.');
      }
      if (challenge.attempts >= 5) {
        throw new UnauthorizedException('Too many attempts. Request a new code.');
      }

      const isTwilioVerify = Buffer.compare(
        challenge.code_hash,
        sha256(TWILIO_VERIFY_MARKER),
      ) === 0;

      let match = false;
      if (isTwilioVerify) {
        const checked = await this.otpDelivery.checkSmsOtp(phone, dto.code);
        match = checked.ok;
      } else {
        match = Buffer.compare(challenge.code_hash, sha256(dto.code)) === 0;
      }

      if (!match) {
        await client.query(
          `UPDATE iam.otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
          [challenge.id],
        );
        await client.query(
          `UPDATE iam.users
           SET failed_login_count = failed_login_count + 1,
               locked_until = CASE WHEN failed_login_count + 1 >= 5
                 THEN now() + interval '15 minutes' ELSE locked_until END
           WHERE id = $1`,
          [user.id],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException('Invalid phone or code');
      }

      await client.query(
        `UPDATE iam.otp_challenges SET consumed_at = now() WHERE id = $1`,
        [challenge.id],
      );
      await client.query(
        `UPDATE iam.users
         SET status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END,
             phone_verified_at = COALESCE(phone_verified_at, now()),
             failed_login_count = 0,
             locked_until = NULL,
             last_login_at = now()
         WHERE id = $1`,
        [user.id],
      );

      const tokens = await this.createSession(
        client,
        user,
        clientType,
        ip,
        userAgent,
      );

      await client.query('COMMIT');
      return tokens;
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

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const hash = sha256(refreshToken);
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        user_id: string;
        client_type: ClientType;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT id, user_id, client_type, expires_at, revoked_at
         FROM iam.sessions
         WHERE refresh_token_hash = $1
         FOR UPDATE`,
        [hash],
      );
      const session = rows[0];
      if (!session || session.revoked_at || session.expires_at < new Date()) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Invalid refresh token');
      }

      const { rows: users } = await client.query<UserRow>(
        `SELECT id, user_type, full_name, phone_e164, email, status, locked_until
         FROM iam.users WHERE id = $1 AND deleted_at IS NULL`,
        [session.user_id],
      );
      const user = users[0];
      if (!user || user.status !== 'active') {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Account not active');
      }

      // Rotate refresh token
      await client.query(
        `UPDATE iam.sessions SET revoked_at = now() WHERE id = $1`,
        [session.id],
      );

      const tokens = await this.createSession(
        client,
        user,
        session.client_type,
        ip,
        userAgent,
      );
      await client.query('COMMIT');
      return tokens;
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

  async logout(sessionId: string) {
    await this.db.query(
      `UPDATE iam.sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    return { ok: true };
  }

  async resolveAuthUser(payload: AccessTokenPayload): Promise<AuthUser> {
    const { rows: sessions } = await this.db.query<{ id: string }>(
      `SELECT id FROM iam.sessions
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.sid, payload.sub],
    );
    if (!sessions[0]) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    await this.db.query(
      `UPDATE iam.sessions SET last_seen_at = now() WHERE id = $1`,
      [payload.sid],
    );

    const { rows: users } = await this.db.query<UserRow>(
      `SELECT id, user_type, full_name, phone_e164, email, status, locked_until
       FROM iam.users WHERE id = $1 AND deleted_at IS NULL`,
      [payload.sub],
    );
    const user = users[0];
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Account not active');
    }

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    return {
      id: user.id,
      sessionId: payload.sid,
      userType: user.user_type,
      fullName: user.full_name,
      phone: user.phone_e164,
      email: user.email,
      roles,
      permissions,
    };
  }

  async me(user: AuthUser) {
    return {
      id: user.id,
      userType: user.userType,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  private async findUserByPhone(phone: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, user_type, full_name, phone_e164, email, status, locked_until
       FROM iam.users
       WHERE phone_e164 = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return rows[0] ?? null;
  }

  private async registerCustomer(phone: string, fullName: string): Promise<UserRow> {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');

      const { rows: users } = await client.query<UserRow>(
        `INSERT INTO iam.users (user_type, phone_e164, full_name, status)
         VALUES ('customer', $1, $2, 'pending_verification')
         RETURNING id, user_type, full_name, phone_e164, email, status, locked_until`,
        [phone, fullName],
      );
      const user = users[0];

      const customerCode = await this.nextDocumentNumber(client, 'CUS');

      await client.query(
        `INSERT INTO crm.customers (user_id, customer_type, customer_code)
         VALUES ($1, 'retail', $2)`,
        [user.id, customerCode],
      );

      await client.query(
        `INSERT INTO iam.user_roles (user_id, role_id)
         SELECT $1, id FROM iam.roles WHERE code = 'retail_customer'`,
        [user.id],
      );

      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async registerStaffAdmin(
    phone: string,
    fullName: string,
  ): Promise<UserRow> {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query<UserRow>(
        `INSERT INTO iam.users (user_type, phone_e164, full_name, status)
         VALUES ('staff', $1, $2, 'pending_verification')
         RETURNING id, user_type, full_name, phone_e164, email, status, locked_until`,
        [phone, fullName],
      );
      const user = users[0];
      await client.query(
        `INSERT INTO iam.user_roles (user_id, role_id)
         SELECT $1, id FROM iam.roles WHERE code = 'et_operations_admin'
         ON CONFLICT DO NOTHING`,
        [user.id],
      );
      await client.query('COMMIT');
      this.logger.log(`Bootstrapped staff admin for ${phone}`);
      return user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private static readonly DEFAULT_ADMIN_PHONES = [
    '+251911129726',
    '+14045101204',
    '+251911419193',
  ];

  /** Admin login is restricted to an explicit phone allowlist. */
  private getAdminPhoneAllowlist(): Set<string> {
    const raw =
      this.config.get<string>('AUTH_ADMIN_PHONE_ALLOWLIST')?.trim() ||
      AuthService.DEFAULT_ADMIN_PHONES.join(',');
    return new Set(
      raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    );
  }

  private assertAdminPhoneAllowlisted(phone: string): void {
    if (!this.getAdminPhoneAllowlist().has(phone)) {
      throw new UnauthorizedException(
        'This phone is not authorized for admin access',
      );
    }
  }

  /** Reject non-staff-admin accounts (after allowlist check). */
  private async assertExistingStaffAdmin(user: UserRow): Promise<void> {
    if (user.user_type === 'driver') {
      throw new UnauthorizedException(
        'Driver accounts cannot sign in to admin. Use a staff phone.',
      );
    }
    if (user.user_type !== 'staff') {
      throw new UnauthorizedException('No admin account for this phone');
    }
    const { rows } = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM iam.user_roles ur
         JOIN iam.roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1
           AND r.code IN ('et_operations_admin', 'super_admin')
           AND (ur.expires_at IS NULL OR ur.expires_at > now())
       ) AS ok`,
      [user.id],
    );
    if (!rows[0]?.ok) {
      throw new UnauthorizedException('No admin account for this phone');
    }
  }

  /**
   * For allowlisted admin phones only: promote to staff + et_operations_admin
   * if needed so the designated owners can always sign in.
   */
  private async ensureAllowlistedStaffAdmin(
    user: UserRow,
    fullName?: string,
  ): Promise<UserRow> {
    if (user.user_type === 'driver') {
      throw new UnauthorizedException(
        'Driver accounts cannot sign in to admin. Use a staff phone.',
      );
    }

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');

      if (user.user_type !== 'staff') {
        await client.query(
          `UPDATE iam.users
           SET user_type = 'staff',
               full_name = COALESCE(NULLIF($2, ''), full_name),
               updated_at = now()
           WHERE id = $1`,
          [user.id, fullName ?? null],
        );
      }

      await client.query(
        `INSERT INTO iam.user_roles (user_id, role_id)
         SELECT $1, id FROM iam.roles WHERE code = 'et_operations_admin'
         ON CONFLICT DO NOTHING`,
        [user.id],
      );

      await client.query(
        `DELETE FROM iam.user_roles ur
         USING iam.roles r
         WHERE ur.user_id = $1 AND ur.role_id = r.id AND r.code = 'retail_customer'`,
        [user.id],
      );

      const { rows } = await client.query<UserRow>(
        `SELECT id, user_type, full_name, phone_e164, email, status, locked_until
         FROM iam.users WHERE id = $1`,
        [user.id],
      );
      await client.query('COMMIT');
      return rows[0] ?? user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async nextDocumentNumber(
    client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ next_value: string }> }> },
    docType: string,
  ): Promise<string> {
    const period = String(new Date().getUTCFullYear());
    await client.query(
      `INSERT INTO core.document_sequences (doc_type, period, next_value)
       VALUES ($1, $2, 1)
       ON CONFLICT (doc_type, period) DO NOTHING`,
      [docType, period],
    );
    const { rows } = await client.query(
      `UPDATE core.document_sequences
       SET next_value = next_value + 1
       WHERE doc_type = $1 AND period = $2
       RETURNING next_value - 1 AS next_value`,
      [docType, period],
    );
    const n = Number(rows[0].next_value);
    return `${docType}-${period}-${String(n).padStart(6, '0')}`;
  }

  private async createSession(
    client: {
      query: <T extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: unknown[],
      ) => Promise<{ rows: T[] }>;
    },
    user: UserRow,
    clientType: ClientType,
    ip?: string,
    userAgent?: string,
  ) {
    const refreshToken = generateRefreshToken();
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    const expiresAt = this.parseDurationToDate(refreshTtl);

    const { rows: sessions } = await client.query<{ id: string }>(
      `INSERT INTO iam.sessions
         (user_id, refresh_token_hash, client_type, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4::inet, $5, $6)
       RETURNING id`,
      [
        user.id,
        sha256(refreshToken),
        clientType,
        ip ?? null,
        userAgent ?? null,
        expiresAt,
      ],
    );
    const sessionId = sessions[0].id;

    const { roles, permissions } = await this.loadRolesAndPermissions(
      user.id,
      client,
    );

    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        sid: sessionId,
        typ: user.user_type,
        roles,
      } satisfies AccessTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        // jsonwebtoken accepts ms-style strings; Nest typings are narrow
        expiresIn: accessTtl as unknown as number,
      },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      user: {
        id: user.id,
        userType: user.user_type,
        fullName: user.full_name,
        phone: user.phone_e164,
        email: user.email,
        roles,
        permissions,
      },
    };
  }

  private async loadRolesAndPermissions(
    userId: string,
    client?: {
      query: <T extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: unknown[],
      ) => Promise<{ rows: T[] }>;
    },
  ) {
    const q = client ?? this.db;
    const { rows: roleRows } = await q.query<{ code: string }>(
      `SELECT r.code
       FROM iam.user_roles ur
       JOIN iam.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
         AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
      [userId],
    );
    const roles = roleRows.map((r) => r.code);

    const { rows: permRows } = await q.query<{ code: string }>(
      `SELECT DISTINCT p.code
       FROM iam.user_roles ur
       JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
       JOIN iam.permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1
         AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
      [userId],
    );
    const permissions = permRows.map((p) => p.code);

    return { roles, permissions };
  }

  private parseDurationToDate(ttl: string): Date {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    const n = Number(match[1]);
    const unit = match[2];
    const ms =
      unit === 's'
        ? n * 1000
        : unit === 'm'
          ? n * 60 * 1000
          : unit === 'h'
            ? n * 60 * 60 * 1000
            : n * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms);
  }
}

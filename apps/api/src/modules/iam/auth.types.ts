export type UserType = 'customer' | 'staff' | 'driver';
export type ClientType = 'web' | 'customer_app' | 'driver_app' | 'admin_web';
export type OtpPurpose =
  | 'login'
  | 'verify_phone'
  | 'verify_email'
  | 'password_reset'
  | 'mfa';

export interface AuthUser {
  id: string;
  sessionId: string;
  userType: UserType;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: UserType;
  roles: string[];
}

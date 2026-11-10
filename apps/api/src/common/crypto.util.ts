import { createHash, randomBytes, randomInt } from 'crypto';

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}

export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Ethiopian mobile: store as +2519xxxxxxxx (E.164). */

export function normalizeEthiopianPhone(raw: string): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  while (digits.startsWith('251251')) {
    digits = digits.slice(3);
  }

  if (digits.startsWith('251') && digits.length >= 12) {
    digits = digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = digits.slice(1);
  }

  if (/^9\d{8}$/.test(digits)) {
    return `+251${digits}`;
  }
  return null;
}

export function isValidEthiopianMobile(raw: string): boolean {
  return normalizeEthiopianPhone(raw) != null;
}

export const ETHIOPIAN_PHONE_ERROR =
  'Please enter a valid Ethiopian phone number, such as 911123456.';

/** Ethiopian mobile: store as +2519xxxxxxxx (E.164). */

export function normalizeEthiopianPhone(raw: string): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Strip duplicated country codes: 2512519… → 2519…
  while (digits.startsWith("251251")) {
    digits = digits.slice(3);
  }

  if (digits.startsWith("251") && digits.length >= 12) {
    digits = digits.slice(3);
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    digits = digits.slice(1);
  }

  // Local mobile: 9xxxxxxxx (9 digits)
  if (/^9\d{8}$/.test(digits)) {
    return `+251${digits}`;
  }
  return null;
}

export function ethiopianLocalPart(e164OrRaw: string): string {
  const normalized = normalizeEthiopianPhone(e164OrRaw);
  if (normalized?.startsWith("+251")) return normalized.slice(4);
  const digits = e164OrRaw.replace(/\D/g, "");
  if (digits.startsWith("251") && digits.length >= 12) return digits.slice(3);
  if (digits.startsWith("0") && digits.length >= 10) return digits.slice(1);
  if (/^9\d{0,8}$/.test(digits)) return digits;
  return "";
}

export function isValidEthiopianMobile(raw: string): boolean {
  return normalizeEthiopianPhone(raw) != null;
}

export const ETHIOPIAN_PHONE_ERROR =
  "Please enter a valid Ethiopian phone number, such as 911123456.";

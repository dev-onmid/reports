/**
 * Normalizes any Brazilian phone number format to 55XXXXXXXXXXX.
 * Accepts:
 *   (43) 9 9999-1111  →  5543999991111
 *   43 99999-1111      →  5543999991111
 *   5543999991111      →  5543999991111
 *   +55 43 9 6666-4444 →  5543966664444
 *   11988887777        →  5511988887777
 */
export function formatPhone(raw: string): string | null {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return null;

  // Already has country code 55
  if (digits.startsWith('55')) {
    const local = digits.slice(2);
    if (local.length === 10 || local.length === 11) return digits;
    return null;
  }

  // DDD + 8-digit (landline) or 9-digit (mobile)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

/** Parses a textarea value into a list of { phone, name } entries.
 *  Each line can be:
 *    phone
 *    phone,name
 *    phone;name
 */
export function parsePhoneList(raw: string): { phone: string; name: string }[] {
  const results: { phone: string; name: string }[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.includes(';') ? ';' : ',';
    const [rawPhone, rawName = ''] = trimmed.split(sep);
    const phone = formatPhone(rawPhone.trim());
    if (phone) results.push({ phone, name: rawName.trim() });
  }
  return results;
}

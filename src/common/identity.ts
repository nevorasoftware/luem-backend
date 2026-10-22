/**
 * Utilidades para el Documento Único de Identidad (DUI) de El Salvador.
 * Formato: 8 dígitos + dígito verificador (########-#).
 * Verificador: suma de d[i] * (9 - i) para i = 0..7; dv = (10 - suma % 10) % 10.
 */
export function normalizeDui(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '');
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

export function isValidDui(input: string): boolean {
  const normalized = normalizeDui(input);
  if (!normalized) return false;
  const digits = normalized.replace('-', '');
  if (/^0{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (9 - i);
  const dv = (10 - (sum % 10)) % 10;
  return dv === Number(digits[8]);
}

export function maskDui(dui: string): string {
  return dui.replace(/^(\d{2})\d{4}(\d{2})-(\d)$/, '$1••••$2-$3');
}

export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return (phone ?? '').replace(/[^\d+]/g, '');
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'•'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

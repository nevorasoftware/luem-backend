import { Prisma } from '@prisma/client';

/** Convierte Decimal/number/string a centavos enteros (evita errores de coma flotante). */
export function toCents(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const str = typeof value === 'object' ? value.toString() : String(value);
  const num = Number(str);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function toCentsOrNull(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return toCents(value);
}

/** Centavos -> string decimal con 2 posiciones (para Prisma.Decimal). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

const usd = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export function formatUSD(cents: number): string {
  return usd.format(cents / 100);
}

/** Porcentaje aplicado a centavos con redondeo bancario simple a centavo. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

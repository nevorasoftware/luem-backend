import { BUSINESS_TIMEZONE } from '../config/env';

const dateTimeFmt = new Intl.DateTimeFormat('es-SV', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateFmt = new Intl.DateTimeFormat('es-SV', {
  timeZone: BUSINESS_TIMEZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateTimeFmt.format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dateFmt.format(new Date(d));
}

/** Fecha calendario (YYYY-MM-DD) en la zona horaria del negocio. */
export function localDateKey(d: Date): string {
  return keyFmt.format(d);
}

/** Año calendario actual en la zona horaria del negocio. */
export function localYear(d: Date = new Date()): number {
  return Number(localDateKey(d).slice(0, 4));
}

/** Convierte una columna @db.Date (UTC medianoche) a clave YYYY-MM-DD. */
export function dbDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Inicio del día local (00:00 en El Salvador) para una clave YYYY-MM-DD, en UTC.
 * Calcula el desfase real de la zona horaria para no asumir un offset fijo.
 */
export function startOfLocalDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMin = tzOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

/** Desfase (minutos) de la zona del negocio respecto a UTC en un instante dado. */
export function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addHours(d: Date, hours: number): Date {
  return addMinutes(d, hours * 60);
}

export function addDays(d: Date, days: number): Date {
  return addMinutes(d, days * 1440);
}

/** Intervalos semiabiertos [aStart, aEnd) y [bStart, bEnd) se solapan. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

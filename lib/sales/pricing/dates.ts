import type { ISODate } from "./types";

// Date helpers on plain "YYYY-MM-DD" strings, computed in UTC so results do
// not depend on the server's time zone.

export function toUTC(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * 86_400_000);
}

// 0 = Sunday ... 6 = Saturday (same as the weekday columns in the database)
export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}

export function nightsOf(checkIn: ISODate, nights: number): ISODate[] {
  return Array.from({ length: Math.max(0, nights) }, (_, i) => addDays(checkIn, i));
}

export const inRange = (d: ISODate, from: ISODate | null, to: ISODate | null) =>
  (!from || d >= from) && (!to || d <= to);

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayName = (d: ISODate) => DAY[weekday(d)];

import type { DailySeries, DayKey, DayWindow } from "./types";

export const ACTIVITY_DAYS = 14;

function isDayKey(value: string): value is DayKey {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function dayKeyOf(at: string | Date): DayKey {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid activity date");
  const value = `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
  if (!isDayKey(value)) throw new RangeError("Activity year must have four digits");
  return value;
}

export function dayWindow(now: Date): DayWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ACTIVITY_DAYS + 1);
  const days = Array.from({ length: ACTIVITY_DAYS }, (_, offset) => {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    return dayKeyOf(day);
  });
  return { days, startIso: start.toISOString() };
}

export function sliceSeries(series: DailySeries, lastDays: 7 | 14): DailySeries {
  return { ...series, days: series.days.slice(-lastDays) };
}

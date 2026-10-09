import { z } from "zod";

// Opening hours are stored per weekday as local "HH:MM" ranges in the
// business's IANA timezone. Closing at or before opening means past midnight.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const intervalSchema = z.object({ open: hhmm, close: hhmm });
export const weeklyHoursSchema = z.partialRecord(z.enum(WEEKDAYS), z.array(intervalSchema));
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

export function parseHours(value: unknown): WeeklyHours {
  const result = weeklyHoursSchema.safeParse(value);
  return result.success ? result.data : {};
}

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: Weekday;
  minutes: number; // minutes since local midnight
}

export function toLocal(instant: Date, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: String(parts.weekday).toLowerCase().slice(0, 3) as Weekday,
    minutes: hour * 60 + minute,
  };
}

/** Converts a local wall-clock date + time in `timeZone` to a UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  // Shift by the zone's offset at that moment; repeat once to settle DST edges.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const local = toLocal(new Date(guess), timeZone);
    const [ly, lmo, ld] = local.date.split("-").map(Number);
    const localAsUtc = Date.UTC(ly!, lmo! - 1, ld!, Math.floor(local.minutes / 60), local.minutes % 60);
    guess += asUtc - localAsUtc;
  }
  return new Date(guess);
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}

/** True when the business is open for the whole span [start, start + durationMin]. */
export function isOpenFor(hours: WeeklyHours, timeZone: string, start: Date, durationMin = 0): boolean {
  const local = toLocal(start, timeZone);
  const end = local.minutes + durationMin;
  const today = hours[local.weekday] ?? [];
  if (today.some(({ open, close }) => {
    const o = toMinutes(open);
    const c = toMinutes(close) <= o ? toMinutes(close) + 24 * 60 : toMinutes(close);
    return local.minutes >= o && end <= c;
  })) {
    return true;
  }
  // Still inside yesterday's interval that runs past midnight?
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(local.weekday) + 6) % 7]!;
  return (hours[yesterday] ?? []).some(({ open, close }) => {
    const o = toMinutes(open);
    const c = toMinutes(close);
    return c <= o && end <= c;
  });
}

export function formatHours(hours: WeeklyHours): string {
  const order: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const label: Record<Weekday, string> = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
  };
  return order
    .map((day) => {
      const ranges = hours[day] ?? [];
      return `${label[day]}: ${ranges.length ? ranges.map((r) => `${r.open}–${r.close}`).join(", ") : "closed"}`;
    })
    .join("\n");
}

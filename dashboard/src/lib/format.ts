import type { Channel } from "../api/types";

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(amount: string | number, currency = "ETB"): string {
  return `${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

export const channelLabel: Record<Channel, string> = {
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  CLI: "Test chat",
};

// --- Business-timezone dates ----------------------------------------------
// Bookings and order times are shown in the business's timezone (e.g.
// Africa/Addis_Ababa), not the browser's, so staff abroad see local times.

/** "YYYY-MM-DD" of an instant in `timeZone`. */
export function dateKeyInZone(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

export function formatInZone(instant: string | Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(instant));
}

/** Adds days to a "YYYY-MM-DD" key (calendar arithmetic, no timezone involved). */
export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `dateKey`. */
export function mondayOf(dateKey: string): string {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((day + 6) % 7));
}

/** Formats a "YYYY-MM-DD" key itself (e.g. "Mon, 12 Oct"). */
export function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...options }).format(new Date(`${dateKey}T12:00:00Z`));
}

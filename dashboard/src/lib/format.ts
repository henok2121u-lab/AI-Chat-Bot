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

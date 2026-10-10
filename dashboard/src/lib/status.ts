import type { BookingStatus, OrderStatus } from "../api/types";

type Color = "amber" | "blue" | "green" | "slate" | "red";

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: Color }> = {
  NEW: { label: "New", color: "amber" },
  CONFIRMED: { label: "Confirmed", color: "blue" },
  READY: { label: "Ready", color: "green" },
  DELIVERED: { label: "Completed", color: "slate" },
  CANCELLED: { label: "Cancelled", color: "red" },
};

export const BOOKING_STATUS: Record<BookingStatus, { label: string; color: Color }> = {
  PENDING: { label: "Pending", color: "amber" },
  CONFIRMED: { label: "Confirmed", color: "green" },
  COMPLETED: { label: "Completed", color: "slate" },
  NO_SHOW: { label: "No-show", color: "red" },
  CANCELLED: { label: "Cancelled", color: "red" },
};

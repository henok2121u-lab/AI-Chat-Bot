import { Router } from "express";
import { z } from "zod";
import type { BookingStatus, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { auth } from "../lib/auth.js";
import { csvEnum, HttpError, idParams } from "../lib/http.js";

const STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;

const NEXT_STATUS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

const listQuery = z
  .object({
    /** Range for the calendar view; defaults to upcoming bookings (from 24h ago). */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** One status or a comma-separated list, e.g. PENDING,CONFIRMED. */
    status: csvEnum(STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((q) => !q.from || !q.to || q.from < q.to, "`from` must be before `to`");

const updateBody = z.object({ status: z.enum(STATUSES) }).strict();

const include = {
  customer: { select: { id: true, name: true, phone: true, channel: true } },
  service: { select: { id: true, name: true, durationMin: true } },
} satisfies Prisma.BookingInclude;

export function bookingsRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { from, to, status, limit } = listQuery.parse(req.query);
    res.json(
      await db.booking.findMany({
        where: {
          businessId: auth(req).businessId,
          status: status && { in: status },
          startsAt: { gte: from ?? new Date(Date.now() - 24 * 60 * 60 * 1000), ...(to && { lt: to }) },
        },
        orderBy: { startsAt: "asc" },
        take: limit,
        include,
      }),
    );
  });

  router.get("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const booking = await db.booking.findFirst({ where: { id, businessId: auth(req).businessId }, include });
    if (!booking) throw new HttpError(404, "Booking not found");
    res.json(booking);
  });

  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { businessId } = auth(req);
    const { status } = updateBody.parse(req.body);

    const booking = await db.booking.findFirst({ where: { id, businessId }, select: { status: true } });
    if (!booking) throw new HttpError(404, "Booking not found");
    if (!NEXT_STATUS[booking.status].includes(status)) {
      throw new HttpError(409, `Can't change a booking from ${booking.status} to ${status}`);
    }

    res.json(await db.booking.update({ where: { id, businessId }, data: { status }, include }));
  });

  return router;
}

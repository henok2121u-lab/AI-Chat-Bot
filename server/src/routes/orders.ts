import { Router } from "express";
import { z } from "zod";
import type { OrderStatus, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { auth } from "../lib/auth.js";
import { csvEnum, HttpError, idParams } from "../lib/http.js";

const STATUSES = ["NEW", "CONFIRMED", "READY", "DELIVERED", "CANCELLED"] as const;

/** Allowed status changes: new → confirmed → ready → delivered, or cancelled before delivery. */
const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const listQuery = z.object({
  /** One status or a comma-separated list, e.g. NEW,CONFIRMED,READY. */
  status: csvEnum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

const updateBody = z.object({ status: z.enum(STATUSES) }).strict();

const include = {
  customer: { select: { id: true, name: true, phone: true, channel: true } },
} satisfies Prisma.OrderInclude;

export function ordersRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { status, limit, before } = listQuery.parse(req.query);
    res.json(
      await db.order.findMany({
        where: { businessId: auth(req).businessId, status: status && { in: status }, ...(before && { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" },
        take: limit,
        include,
      }),
    );
  });

  router.get("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const order = await db.order.findFirst({ where: { id, businessId: auth(req).businessId }, include });
    if (!order) throw new HttpError(404, "Order not found");
    res.json(order);
  });

  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { businessId } = auth(req);
    const { status } = updateBody.parse(req.body);

    const order = await db.order.findFirst({ where: { id, businessId }, select: { status: true } });
    if (!order) throw new HttpError(404, "Order not found");
    if (!NEXT_STATUS[order.status].includes(status)) {
      throw new HttpError(409, `Can't change an order from ${order.status} to ${status}`);
    }

    res.json(await db.order.update({ where: { id, businessId }, data: { status }, include }));
  });

  return router;
}

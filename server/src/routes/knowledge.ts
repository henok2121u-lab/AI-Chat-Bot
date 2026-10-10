import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { auth } from "../lib/auth.js";
import { idParams, money, optionalText } from "../lib/http.js";

// CRUD for what the bot knows: menu items, services and FAQs. Every query is
// scoped by the session's businessId; ids from another business 404.

// Base schemas have no defaults: zod applies defaults even inside .partial(),
// which would silently reset fields on PATCH. Defaults are added for create only.
const sortOrder = z.number().int().min(0).max(100_000);

const menuItemFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  price: money,
  category: z.string().trim().min(1).max(60),
  available: z.boolean(),
  sortOrder,
});
const createMenuItem = menuItemFields.extend({ available: z.boolean().default(true), sortOrder: sortOrder.default(0) });
const updateMenuItem = menuItemFields.partial().strict();

const serviceFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  durationMin: z.number().int().min(5).max(24 * 60),
  price: money,
  available: z.boolean(),
});
const createService = serviceFields.extend({ available: z.boolean().default(true) });
const updateService = serviceFields.partial().strict();

const faqFields = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(3000),
  sortOrder,
});
const createFaq = faqFields.extend({ sortOrder: sortOrder.default(0) });
const updateFaq = faqFields.partial().strict();

export function menuItemsRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json(
      await db.menuItem.findMany({
        where: { businessId: auth(req).businessId },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      }),
    );
  });

  router.post("/", async (req, res) => {
    const data = createMenuItem.parse(req.body);
    res.status(201).json(await db.menuItem.create({ data: { ...data, businessId: auth(req).businessId } }));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const data = updateMenuItem.parse(req.body);
    res.json(await db.menuItem.update({ where: { id, businessId: auth(req).businessId }, data }));
  });

  router.delete("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    await db.menuItem.delete({ where: { id, businessId: auth(req).businessId } });
    res.status(204).end();
  });

  return router;
}

export function servicesRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json(await db.service.findMany({ where: { businessId: auth(req).businessId }, orderBy: { name: "asc" } }));
  });

  router.post("/", async (req, res) => {
    const data = createService.parse(req.body);
    res.status(201).json(await db.service.create({ data: { ...data, businessId: auth(req).businessId } }));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const data = updateService.parse(req.body);
    res.json(await db.service.update({ where: { id, businessId: auth(req).businessId }, data }));
  });

  router.delete("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    await db.service.delete({ where: { id, businessId: auth(req).businessId } });
    res.status(204).end();
  });

  return router;
}

export function faqsRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json(
      await db.faq.findMany({
        where: { businessId: auth(req).businessId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    );
  });

  router.post("/", async (req, res) => {
    const data = createFaq.parse(req.body);
    res.status(201).json(await db.faq.create({ data: { ...data, businessId: auth(req).businessId } }));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const data = updateFaq.parse(req.body);
    res.json(await db.faq.update({ where: { id, businessId: auth(req).businessId }, data }));
  });

  router.delete("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    await db.faq.delete({ where: { id, businessId: auth(req).businessId } });
    res.status(204).end();
  });

  return router;
}

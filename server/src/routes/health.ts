import { Router } from "express";
import { db } from "../lib/db.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

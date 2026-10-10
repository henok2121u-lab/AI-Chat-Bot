import { type NextFunction, type Request, type Response, Router } from "express";
import type { OutboundSender } from "../channels/outbound.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { requireAuth } from "../lib/auth.js";
import { HttpError } from "../lib/http.js";
import { authRouter } from "./auth.js";
import { bookingsRouter } from "./bookings.js";
import { businessRouter } from "./business.js";
import { conversationsRouter } from "./conversations.js";
import { faqsRouter, menuItemsRouter, servicesRouter } from "./knowledge.js";
import { ordersRouter } from "./orders.js";

export interface ApiDeps {
  db: PrismaClient;
  sendToCustomer: OutboundSender;
}

/**
 * State-changing requests must be JSON. Browsers can't send cross-site JSON
 * without a CORS preflight, so together with SameSite cookies this blocks CSRF.
 */
function requireJsonBody(req: Request, _res: Response, next: NextFunction) {
  const hasBody = req.headers["content-length"] !== "0" && (req.headers["content-length"] || req.headers["transfer-encoding"]);
  if (["POST", "PUT", "PATCH"].includes(req.method) && hasBody && !req.is("application/json")) {
    throw new HttpError(415, "Request body must be JSON");
  }
  next();
}

/** Dashboard REST API, mounted at /api. Everything except /auth requires a session. */
export function apiRouter({ db, sendToCustomer }: ApiDeps): Router {
  const router = Router();
  router.use(requireJsonBody);

  router.use("/auth", authRouter(db));

  router.use(requireAuth(db));
  router.use("/business", businessRouter(db));
  router.use("/menu-items", menuItemsRouter(db));
  router.use("/services", servicesRouter(db));
  router.use("/faqs", faqsRouter(db));
  router.use("/conversations", conversationsRouter(db, sendToCustomer));
  router.use("/orders", ordersRouter(db));
  router.use("/bookings", bookingsRouter(db));

  return router;
}

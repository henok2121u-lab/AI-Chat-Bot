import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  auth,
  clearSessionCookie,
  hashPassword,
  requireAuth,
  setSessionCookie,
  signSession,
  verifyPassword,
} from "../lib/auth.js";
import { env } from "../lib/env.js";
import { HttpError } from "../lib/http.js";

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(200));

const registerBody = z.object({
  businessName: z.string().trim().min(2).max(100),
  businessType: z.enum(["RESTAURANT", "CLINIC", "SALON", "OTHER"]).default("RESTAURANT"),
  name: z.string().trim().min(1).max(100),
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
});

// A sensible starting point the owner edits on the Knowledge page.
const DEFAULT_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [{ open: "09:00", close: "18:00" }]]),
);

// Compared against when the email doesn't exist, so login takes the same time either way.
const dummyHash = hashPassword("not-a-real-password");

const userFields = { id: true, email: true, name: true, role: true } as const;
const businessFields = { id: true, name: true, type: true } as const;

export function authRouter(db: PrismaClient): Router {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: { error: "Too many attempts, please try again in a few minutes" },
  });

  router.post("/register", limiter, async (req, res) => {
    const body = registerBody.parse(req.body);
    if (await db.user.findUnique({ where: { email: body.email } })) {
      throw new HttpError(409, "An account with this email already exists");
    }

    const user = await db.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: "OWNER",
        business: { create: { name: body.businessName, type: body.businessType, hours: DEFAULT_HOURS } },
      },
      select: { ...userFields, businessId: true, business: { select: businessFields } },
    });

    setSessionCookie(res, await signSession(user));
    const { businessId: _bid, business, ...publicUser } = user;
    res.status(201).json({ user: publicUser, business });
  });

  router.post("/login", limiter, async (req, res) => {
    const body = loginBody.parse(req.body);
    const user = await db.user.findUnique({
      where: { email: body.email },
      select: { ...userFields, businessId: true, passwordHash: true, business: { select: businessFields } },
    });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) throw new HttpError(401, "Wrong email or password");

    setSessionCookie(res, await signSession(user));
    const { passwordHash: _hash, businessId: _bid, business, ...publicUser } = user;
    res.json({ user: publicUser, business });
  });

  router.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/me", requireAuth(db), async (req, res) => {
    const { userId } = auth(req);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ...userFields, business: { select: businessFields } },
    });
    const { business, ...publicUser } = user;
    res.json({ user: publicUser, business });
  });

  return router;
}

import bcrypt from "bcryptjs";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import type { PrismaClient, UserRole } from "../generated/prisma/client.js";
import { env } from "./env.js";
import { HttpError } from "./http.js";

// Sessions are a signed JWT in an httpOnly cookie. Every authenticated request
// carries the user's businessId, which all API queries are scoped by.

export interface AuthContext {
  userId: string;
  businessId: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const SESSION_COOKIE = "sb_session";
const SESSION_DAYS = 7;
const secret = new TextEncoder().encode(env.JWT_SECRET);

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  // Lax blocks the cookie on cross-site POSTs (basic CSRF protection); the API
  // also only accepts JSON bodies.
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signSession(user: { id: string; businessId: string; role: UserRole }) {
  return new SignJWT({ bid: user.businessId, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
}

export function clearSessionCookie(res: Response) {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions;
  res.clearCookie(SESSION_COOKIE, options);
}

/** Requires a valid session; re-checks the user still exists so deleted users lose access immediately. */
export function requireAuth(db: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || !token) throw new HttpError(401, "Not logged in");

    let userId: string;
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      if (!payload.sub) throw new Error("missing sub");
      userId = payload.sub;
    } catch {
      throw new HttpError(401, "Session expired, please log in again");
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, businessId: true, role: true } });
    if (!user) throw new HttpError(401, "Session expired, please log in again");

    req.auth = { userId: user.id, businessId: user.businessId, role: user.role };
    next();
  };
}

/** The authenticated context; only call behind requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw new HttpError(401, "Not logged in");
  return req.auth;
}

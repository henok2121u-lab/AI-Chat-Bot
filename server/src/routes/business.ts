import { GrammyError } from "grammy";
import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { connectTelegramBot, disconnectTelegramBot } from "../channels/telegram.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { auth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { HttpError, money, optionalText } from "../lib/http.js";
import { detectNgrokUrl } from "../lib/ngrok.js";
import { weeklyHoursSchema } from "../lib/time.js";

const updateBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    type: z.enum(["RESTAURANT", "CLINIC", "SALON", "OTHER"]),
    description: optionalText(1000),
    hours: weeklyHoursSchema,
    timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown timezone"),
    currency: z.string().trim().length(3).toUpperCase(),
    location: optionalText(300),
    phone: optionalText(40),
    policies: optionalText(5000),
    bookingSlotCapacity: z.number().int().min(1).max(1000),
    deliveryFee: money,
    freeDeliveryThreshold: money.nullable(),
    minDeliveryOrder: money.nullable(),
    botEnabled: z.boolean(),
  })
  .partial()
  .strict();

const telegramBody = z.object({ token: z.string().trim().regex(/^\d+:[\w-]{20,}$/, "That doesn't look like a bot token from @BotFather") });

// Everything except channel secrets.
const publicFields = {
  id: true,
  name: true,
  type: true,
  description: true,
  hours: true,
  timezone: true,
  currency: true,
  location: true,
  phone: true,
  policies: true,
  bookingSlotCapacity: true,
  deliveryFee: true,
  freeDeliveryThreshold: true,
  minDeliveryOrder: true,
  botEnabled: true,
  telegramBotUsername: true,
  telegramBotToken: true,
  whatsappPhoneNumberId: true,
  createdAt: true,
  updatedAt: true,
} as const;

function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (auth(req).role !== "OWNER") throw new HttpError(403, "Only the business owner can change settings");
  next();
}

export function businessRouter(db: PrismaClient): Router {
  const router = Router();

  async function load(businessId: string) {
    const { telegramBotToken, telegramBotUsername, whatsappPhoneNumberId, ...business } = await db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: publicFields,
    });
    return {
      ...business,
      channels: {
        telegram: { connected: telegramBotToken !== null, botUsername: telegramBotUsername },
        whatsapp: { connected: whatsappPhoneNumberId !== null, phoneNumberId: whatsappPhoneNumberId },
      },
    };
  }

  router.get("/", async (req, res) => {
    res.json(await load(auth(req).businessId));
  });

  router.patch("/", requireOwner, async (req, res) => {
    const { businessId } = auth(req);
    await db.business.update({ where: { id: businessId }, data: updateBody.parse(req.body) });
    res.json(await load(businessId));
  });

  router.post("/telegram", requireOwner, async (req, res) => {
    const { businessId } = auth(req);
    const { token } = telegramBody.parse(req.body);

    const publicUrl = env.PUBLIC_URL ?? (env.NODE_ENV === "development" ? await detectNgrokUrl() : undefined);
    if (!publicUrl) throw new HttpError(400, "The server has no public URL. Set PUBLIC_URL (or start ngrok in development).");

    try {
      await connectTelegramBot(db, { businessId, token, publicUrl });
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 401) throw new HttpError(400, "Telegram rejected this bot token");
      throw err;
    }
    res.json(await load(businessId));
  });

  router.delete("/telegram", requireOwner, async (req, res) => {
    const { businessId } = auth(req);
    await disconnectTelegramBot(db, businessId);
    res.json(await load(businessId));
  });

  return router;
}

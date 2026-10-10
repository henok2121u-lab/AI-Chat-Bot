import { randomBytes, timingSafeEqual } from "node:crypto";
import { type Request, type Response, Router } from "express";
import { Api } from "grammy";
import type { Update } from "grammy/types";
import type { Logger } from "pino";
import type { ConversationEngine, IncomingMessage, ReplySender } from "../engine/conversation.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import type { KeyedQueue } from "../lib/keyed-queue.js";

// Telegram channel adapter. One bot per business: its token and webhook secret
// are stored encrypted on Business, and Telegram posts updates to
// /webhooks/telegram/:businessId with the secret in a header.

/** The grammy Api methods the adapter uses (tests pass a fake). */
export type TelegramApi = Pick<Api, "sendMessage" | "sendChatAction">;
export type TelegramApiFactory = (token: string) => TelegramApi;

export interface TelegramWebhookDeps {
  db: PrismaClient;
  engine: ConversationEngine;
  logger: Logger;
  queue: KeyedQueue;
  createApi?: TelegramApiFactory;
}

const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const MAX_MESSAGE_LENGTH = 4096;

const UNSUPPORTED_REPLY =
  "Sorry, I can only read text messages for now — please type your question.\n" +
  "ይቅርታ፣ ለአሁን የጽሑፍ መልዕክቶችን ብቻ ማንበብ እችላለሁ። እባክዎ ጥያቄዎን ይጻፉ።";

type NormalizedUpdate =
  | { kind: "text"; chatId: number; message: IncomingMessage }
  | { kind: "unsupported"; chatId: number };

/** Converts a Telegram update into the engine's channel-agnostic message, or null to ignore it. */
export function normalizeUpdate(businessId: string, update: Update): NormalizedUpdate | null {
  const message = update.message;
  // Only direct chats with the bot; groups, channels, edits and button callbacks are ignored.
  if (!message || message.chat.type !== "private") return null;

  const chatId = message.chat.id;
  if (!message.text) return { kind: "unsupported", chatId };

  const from = message.from;
  const customerName = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || undefined;
  // "/start" is sent when someone opens the bot for the first time.
  const text = message.text.trim() === "/start" ? "Hi!" : message.text;

  return {
    kind: "text",
    chatId,
    message: {
      businessId,
      channel: "telegram",
      externalUserId: String(chatId),
      customerName,
      text,
      // Unique within a chat, and conversations are per chat — so retries are dropped.
      externalMessageId: String(message.message_id),
    },
  };
}

export function telegramSender(api: TelegramApi): ReplySender {
  return {
    async send(chatId, text) {
      for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
        await api.sendMessage(chatId, text.slice(i, i + MAX_MESSAGE_LENGTH));
      }
    },
  };
}

function secretsMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function telegramWebhookRouter(deps: TelegramWebhookDeps): Router {
  const { db, engine, logger, queue } = deps;
  const createApi = deps.createApi ?? ((token: string) => new Api(token));
  const router = Router();

  router.post("/:businessId", async (req: Request<{ businessId: string }>, res: Response) => {
    const { businessId } = req.params;
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { telegramBotToken: true, telegramWebhookSecret: true },
    });
    if (!business?.telegramBotToken || !business.telegramWebhookSecret) {
      res.sendStatus(404);
      return;
    }
    if (!secretsMatch(req.get(SECRET_HEADER) ?? "", decryptSecret(business.telegramWebhookSecret))) {
      res.sendStatus(401);
      return;
    }

    // Acknowledge right away so Telegram doesn't retry; the reply goes out via the Bot API.
    res.sendStatus(200);

    const update = req.body as Update;
    const normalized = normalizeUpdate(businessId, update);
    if (!normalized) return;

    const log = logger.child({ businessId, channel: "telegram", chatId: normalized.chatId, updateId: update.update_id });
    const api = createApi(decryptSecret(business.telegramBotToken));

    void queue.push(`telegram:${businessId}:${normalized.chatId}`, async () => {
      if (normalized.kind === "unsupported") {
        await api.sendMessage(normalized.chatId, UNSUPPORTED_REPLY);
        return;
      }
      await api.sendChatAction(normalized.chatId, "typing").catch((err) => log.debug({ err }, "sendChatAction failed"));
      const result = await engine.handleIncomingMessage(normalized.message, telegramSender(api));
      log.info({ status: result.status }, "Telegram message handled");
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Connecting a bot (used by the CLI script now, and the dashboard later)
// ---------------------------------------------------------------------------

export function telegramWebhookUrl(publicUrl: string, businessId: string): string {
  return new URL(`/webhooks/telegram/${encodeURIComponent(businessId)}`, publicUrl).toString();
}

/**
 * Validates the bot token, stores it (encrypted) with a fresh webhook secret,
 * and points the bot's webhook at this server.
 */
export async function connectTelegramBot(
  db: PrismaClient,
  opts: { businessId: string; token: string; publicUrl: string },
) {
  const api = new Api(opts.token);
  const me = await api.getMe(); // throws on an invalid token

  const secret = randomBytes(32).toString("base64url"); // Telegram allows A-Z a-z 0-9 _ -
  const webhookUrl = telegramWebhookUrl(opts.publicUrl, opts.businessId);

  // Save before setWebhook so the first update already finds the new secret.
  await db.business.update({
    where: { id: opts.businessId },
    data: {
      telegramBotToken: encryptSecret(opts.token),
      telegramWebhookSecret: encryptSecret(secret),
      telegramBotUsername: me.username,
    },
  });
  await api.setWebhook(webhookUrl, {
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  return { bot: { id: me.id, username: me.username, name: me.first_name }, webhookUrl };
}

export async function disconnectTelegramBot(db: PrismaClient, businessId: string) {
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (business.telegramBotToken) {
    await new Api(decryptSecret(business.telegramBotToken)).deleteWebhook();
  }
  await db.business.update({
    where: { id: businessId },
    data: { telegramBotToken: null, telegramWebhookSecret: null, telegramBotUsername: null },
  });
}

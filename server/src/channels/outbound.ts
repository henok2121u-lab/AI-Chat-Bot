import { Api } from "grammy";
import type { Channel, PrismaClient } from "../generated/prisma/client.js";
import { decryptSecret } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";
import { type TelegramApiFactory, telegramSender } from "./telegram.js";

/** Delivers a staff (agent) message to the customer on the conversation's channel. */
export type OutboundSender = (target: { businessId: string; channel: Channel; externalUserId: string }, text: string) => Promise<void>;

export function createOutboundSender(
  db: PrismaClient,
  createTelegramApi: TelegramApiFactory = (token) => new Api(token),
): OutboundSender {
  return async ({ businessId, channel, externalUserId }, text) => {
    switch (channel) {
      case "TELEGRAM": {
        const business = await db.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { telegramBotToken: true },
        });
        if (!business.telegramBotToken) throw new HttpError(409, "Telegram is not connected for this business");
        await telegramSender(createTelegramApi(decryptSecret(business.telegramBotToken))).send(externalUserId, text);
        return;
      }
      case "CLI":
        return; // terminal test chats: the message is only stored
      case "WHATSAPP":
        throw new HttpError(501, "Sending WhatsApp messages isn't available yet");
    }
  };
}

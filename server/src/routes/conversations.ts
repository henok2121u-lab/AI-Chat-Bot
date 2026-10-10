import { Router } from "express";
import { z } from "zod";
import type { OutboundSender } from "../channels/outbound.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { auth } from "../lib/auth.js";
import { HttpError, idParams } from "../lib/http.js";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

const listQuery = z.object({
  filter: z.enum(["all", "attention", "human"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Pagination: conversations whose last message is older than this. */
  before: z.coerce.date().optional(),
});

const messagesQuery = z.object({
  /** Polling: only messages created after this time. */
  after: z.coerce.date().optional(),
});

const updateBody = z
  .object({
    mode: z.enum(["BOT", "HUMAN"]),
    needsAttention: z.boolean(),
  })
  .partial()
  .strict();

const replyBody = z.object({ text: z.string().trim().min(1).max(4000) });

const customerFields = { id: true, name: true, phone: true, channel: true } as const;

/** WhatsApp only allows free-form replies within 24h of the customer's last message. */
function replyWindow(c: { channel: string; lastCustomerMessageAt: Date | null }, now = Date.now()) {
  if (c.channel !== "WHATSAPP") return { replyWindowEndsAt: null, canReply: true };
  const endsAt = c.lastCustomerMessageAt ? new Date(c.lastCustomerMessageAt.getTime() + WHATSAPP_WINDOW_MS) : null;
  return { replyWindowEndsAt: endsAt, canReply: endsAt !== null && endsAt.getTime() > now };
}

export function conversationsRouter(db: PrismaClient, sendToCustomer: OutboundSender): Router {
  const router = Router();

  async function findOwned(businessId: string, id: string) {
    const conversation = await db.conversation.findFirst({
      where: { id, businessId },
      include: { customer: { select: { ...customerFields, externalId: true } } },
    });
    if (!conversation) throw new HttpError(404, "Conversation not found");
    return conversation;
  }

  router.get("/", async (req, res) => {
    const { businessId } = auth(req);
    const { filter, limit, before } = listQuery.parse(req.query);

    const where: Prisma.ConversationWhereInput = {
      businessId,
      ...(filter === "attention" && { needsAttention: true }),
      ...(filter === "human" && { mode: "HUMAN" }),
      ...(before && { lastMessageAt: { lt: before } }),
    };
    const conversations = await db.conversation.findMany({
      where,
      orderBy: [{ needsAttention: "desc" }, { lastMessageAt: "desc" }],
      take: limit,
      include: {
        customer: { select: customerFields },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, text: true, createdAt: true } },
      },
    });

    res.json(
      conversations.map(({ messages, ...c }) => ({ ...c, lastMessage: messages[0] ?? null, ...replyWindow(c) })),
    );
  });

  router.get("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { customer, ...conversation } = await findOwned(auth(req).businessId, id);
    const { externalId: _externalId, ...publicCustomer } = customer;

    const messages = await db.message.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, role: true, text: true, createdAt: true },
    });
    const [orders, bookings] = await Promise.all([
      db.order.findMany({ where: { conversationId: id, businessId: conversation.businessId }, orderBy: { createdAt: "desc" } }),
      db.booking.findMany({ where: { conversationId: id, businessId: conversation.businessId }, orderBy: { startsAt: "desc" } }),
    ]);

    res.json({
      ...conversation,
      ...replyWindow(conversation),
      customer: publicCustomer,
      messages: messages.reverse(),
      orders,
      bookings,
    });
  });

  router.get("/:id/messages", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { after } = messagesQuery.parse(req.query);
    await findOwned(auth(req).businessId, id);

    res.json(
      await db.message.findMany({
        where: { conversationId: id, ...(after && { createdAt: { gt: after } }) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
        select: { id: true, role: true, text: true, createdAt: true },
      }),
    );
  });

  /** Take over (mode HUMAN), give back to the bot (mode BOT), or mark as seen (needsAttention false). */
  router.patch("/:id", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { businessId } = auth(req);
    const body = updateBody.parse(req.body);
    await findOwned(businessId, id);

    const handingBack = body.mode === "BOT";
    const updated = await db.conversation.update({
      where: { id, businessId },
      data: {
        ...body,
        // Someone acted on it, so it no longer needs attention (unless explicitly set).
        needsAttention: body.needsAttention ?? (body.mode ? false : undefined),
        ...(handingBack && { handoffReason: null }),
      },
    });
    res.json({ ...updated, ...replyWindow(updated) });
  });

  /** Staff reply: sent to the customer on their channel, then stored. Pauses the bot for this chat. */
  router.post("/:id/messages", async (req, res) => {
    const { id } = idParams.parse(req.params);
    const { businessId } = auth(req);
    const { text } = replyBody.parse(req.body);
    const conversation = await findOwned(businessId, id);

    if (!replyWindow(conversation).canReply) {
      throw new HttpError(409, "WhatsApp's 24-hour reply window has closed; a message template is needed to reply.");
    }

    await sendToCustomer(
      { businessId, channel: conversation.channel, externalUserId: conversation.customer.externalId },
      text,
    );

    const now = new Date();
    const [message] = await db.$transaction([
      db.message.create({
        data: { conversationId: id, role: "AGENT", text, createdAt: now },
        select: { id: true, role: true, text: true, createdAt: true },
      }),
      db.conversation.update({
        where: { id, businessId },
        data: { mode: "HUMAN", needsAttention: false, lastMessageAt: now },
      }),
    ]);
    res.status(201).json(message);
  });

  return router;
}

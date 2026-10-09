import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { pino } from "pino";
import { createConversationEngine, type IncomingMessage, type ReplySender } from "../engine/conversation.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AiClient } from "../lib/ai.js";

export const silentLogger = pino({ level: "silent" });

/** Wednesday 2026-10-07 12:00 in Addis Ababa (UTC+3) — inside opening hours. */
export const LUNCHTIME = new Date("2026-10-07T09:00:00Z");

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Step = (params: Params) => Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason">;

/**
 * Fake AI client that replays a script of responses and records every request.
 * Requests are deep-copied because the engine keeps appending to `messages`.
 */
export function scriptedAi(steps: Step[]) {
  const calls: Params[] = [];
  const client: AiClient = {
    async createMessage(params) {
      calls.push(structuredClone(params));
      const step = steps[calls.length - 1];
      if (!step) throw new Error(`Unexpected model call #${calls.length}`);
      const { content, stop_reason } = step(params);
      return {
        id: `msg_${calls.length}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content,
        stop_reason,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  return { client, calls };
}

export const toolUse = (name: string, input: Record<string, unknown>, id = `toolu_${randomUUID()}`): Step => () => ({
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "One moment.", citations: null },
    { type: "tool_use", id, name, input },
  ] as Anthropic.Beta.BetaContentBlock[],
});

export const say = (text: string): Step => () => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text, citations: null }] as Anthropic.Beta.BetaContentBlock[],
});

/** The tool_result blocks the engine sent back on a given model call. */
export function toolResultsSentOn(call: Params) {
  const last = call.messages.at(-1)!;
  if (last.role !== "user" || typeof last.content === "string") throw new Error("Last message is not a tool result");
  return last.content.filter((b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === "tool_result");
}

export function resultJson(block: Anthropic.Beta.BetaToolResultBlockParam) {
  return JSON.parse(block.content as string) as Record<string, any>;
}

export function captureSender() {
  const sent: { to: string; text: string }[] = [];
  const sender: ReplySender = {
    async send(to, text) {
      sent.push({ to, text });
    },
  };
  return { sender, sent };
}

/** A small restaurant like the demo seed, with a unique id so tests don't collide. */
export async function createTestRestaurant(db: PrismaClient) {
  const allWeek = { open: "07:00", close: "22:30" };
  const business = await db.business.create({
    data: {
      id: `test-${randomUUID()}`,
      name: "Test Habesha Kitchen",
      type: "RESTAURANT",
      hours: { mon: [allWeek], tue: [allWeek], wed: [allWeek], thu: [allWeek], fri: [allWeek], sat: [allWeek], sun: [allWeek] },
      timezone: "Africa/Addis_Ababa",
      currency: "ETB",
      deliveryFee: 100,
      freeDeliveryThreshold: 2000,
      minDeliveryOrder: 400,
    },
  });
  const item = (name: string, price: number, available = true) =>
    db.menuItem.create({ data: { businessId: business.id, name, price, category: "Main", available } });

  const [doroWat, injera, goredGored] = await Promise.all([
    item("Doro Wat", 950),
    item("Extra Injera", 40),
    item("Gored Gored", 1000, false),
  ]);
  return { business, menu: { doroWat, injera, goredGored } };
}

export function engineWith(db: PrismaClient, ai: AiClient, now = LUNCHTIME) {
  return createConversationEngine({
    db,
    ai,
    logger: silentLogger,
    model: "claude-opus-5-5",
    effort: "medium",
    now: () => now,
  });
}

export function incoming(businessId: string, text: string, extra: Partial<IncomingMessage> = {}): IncomingMessage {
  return { businessId, channel: "telegram", externalUserId: `tg-${randomUUID()}`, customerName: "Abebe", text, ...extra };
}

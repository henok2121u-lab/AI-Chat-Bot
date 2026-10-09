import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { type Channel, Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { AiClient } from "../lib/ai.js";
import { buildKnowledgePrompt, buildTurnContext, loadBusinessKnowledge } from "./prompt.js";
import { executeTool, toolDefinitions, type ToolContext } from "./tools.js";

export type ChannelName = "telegram" | "whatsapp" | "cli";

/** What every channel adapter turns an incoming webhook/update into. */
export interface IncomingMessage {
  businessId: string;
  channel: ChannelName;
  externalUserId: string;
  customerName?: string;
  text: string;
  /** Channel message id, used to drop webhook retries. */
  externalMessageId?: string;
}

/** Sends a message back to the customer through the channel it came from. */
export interface ReplySender {
  send(externalUserId: string, text: string): Promise<void>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface EngineDeps {
  db: PrismaClient;
  ai: AiClient;
  logger: Logger;
  model: string;
  effort: Effort;
  now?: () => Date;
  /** Messages of history sent to the model (including the new one). */
  historyLimit?: number;
  /** Safety cap on model calls per incoming message. */
  maxModelCalls?: number;
}

export type HandleResult =
  | { status: "replied"; conversationId: string; reply: string }
  | { status: "duplicate" }
  | { status: "human_mode" | "bot_disabled"; conversationId: string };

const CHANNEL: Record<ChannelName, Channel> = { telegram: "TELEGRAM", whatsapp: "WHATSAPP", cli: "CLI" };

export const FALLBACK_REPLY =
  "Sorry, I'm having trouble answering right now. A member of our staff will get back to you here shortly.";

export function createConversationEngine(deps: EngineDeps) {
  const { db, ai, logger, model, effort } = deps;
  const now = deps.now ?? (() => new Date());
  const historyLimit = deps.historyLimit ?? 20;
  const maxModelCalls = deps.maxModelCalls ?? 8;

  async function handleIncomingMessage(msg: IncomingMessage, sender: ReplySender): Promise<HandleResult> {
    const channel = CHANNEL[msg.channel];
    const log = logger.child({ businessId: msg.businessId, channel: msg.channel, externalUserId: msg.externalUserId });

    const business = await db.business.findUniqueOrThrow({
      where: { id: msg.businessId },
      select: { id: true, botEnabled: true },
    });

    const customer = await db.customer.upsert({
      where: { businessId_channel_externalId: { businessId: business.id, channel, externalId: msg.externalUserId } },
      create: { businessId: business.id, channel, externalId: msg.externalUserId, name: msg.customerName },
      update: msg.customerName ? { name: msg.customerName } : {},
    });

    const conversation =
      (await db.conversation.findFirst({
        where: { businessId: business.id, customerId: customer.id },
        orderBy: { lastMessageAt: "desc" },
      })) ??
      (await db.conversation.create({
        data: { businessId: business.id, customerId: customer.id, channel },
      }));

    // Save the incoming message; the unique (conversationId, externalId) index drops retries.
    const receivedAt = now();
    try {
      await db.message.create({
        data: {
          conversationId: conversation.id,
          role: "CUSTOMER",
          text: msg.text,
          externalId: msg.externalMessageId,
          createdAt: receivedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        log.debug({ externalMessageId: msg.externalMessageId }, "Duplicate message ignored");
        return { status: "duplicate" };
      }
      throw err;
    }

    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: receivedAt, lastCustomerMessageAt: receivedAt },
    });

    if (conversation.mode === "HUMAN" || !business.botEnabled) {
      await db.conversation.update({ where: { id: conversation.id }, data: { needsAttention: true } });
      // Dashboard picks this up by polling needsAttention (SSE later).
      log.info({ conversationId: conversation.id }, "Message waiting for staff");
      return { status: conversation.mode === "HUMAN" ? "human_mode" : "bot_disabled", conversationId: conversation.id };
    }

    const toolCtx: ToolContext = {
      db,
      businessId: business.id,
      customerId: customer.id,
      conversationId: conversation.id,
      now: receivedAt,
    };

    let reply: string;
    try {
      reply = await generateReply(toolCtx, customer.name, channel, log);
    } catch (err) {
      log.error({ err, conversationId: conversation.id }, "AI reply failed");
      await db.conversation.update({ where: { id: conversation.id }, data: { needsAttention: true } });
      reply = FALLBACK_REPLY;
    }

    const sentAt = now();
    await db.message.create({
      data: { conversationId: conversation.id, role: "BOT", text: reply, createdAt: sentAt },
    });
    await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: sentAt } });

    try {
      await sender.send(msg.externalUserId, reply);
    } catch (err) {
      log.error({ err, conversationId: conversation.id }, "Failed to send reply");
    }

    return { status: "replied", conversationId: conversation.id, reply };
  }

  /** Runs Claude with tools until it produces a final text reply. */
  async function generateReply(ctx: ToolContext, customerName: string | null, channel: Channel, log: Logger) {
    const knowledge = await loadBusinessKnowledge(db, ctx.businessId);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      // Stable per business, so tools + this block form a cacheable prefix.
      { type: "text", text: buildKnowledgePrompt(knowledge), cache_control: { type: "ephemeral" } },
      { type: "text", text: buildTurnContext(knowledge, { now: ctx.now, customerName, channel }) },
    ];
    const messages = await loadHistory(ctx.conversationId);

    for (let call = 0; call < maxModelCalls; call++) {
      const response = await ai.createMessage({
        model,
        max_tokens: 16000,
        system,
        tools: toolDefinitions,
        messages,
        output_config: { effort },
        // On a safety-classifier refusal, retry server-side on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        log.warn({ stopDetails: response.stop_details }, "Model refused");
        await flagForStaff(ctx);
        return FALLBACK_REPLY;
      }

      if (response.stop_reason === "tool_use") {
        // Append the whole assistant turn unchanged (thinking blocks included).
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        // Sequential on purpose: tools write to the DB and may depend on each other.
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const result = await runTool(block, ctx, log);
          results.push({ type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "max_tokens") log.warn("Reply hit max_tokens");
      if (!text) {
        await flagForStaff(ctx);
        return FALLBACK_REPLY;
      }
      return text;
    }

    log.warn({ maxModelCalls }, "Tool loop limit reached");
    await flagForStaff(ctx);
    return FALLBACK_REPLY;
  }

  async function runTool(block: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext, log: Logger) {
    try {
      const result = await executeTool(block.name, block.input, ctx);
      log.info({ tool: block.name, isError: result.isError ?? false }, "Tool call");
      return result;
    } catch (err) {
      log.error({ err, tool: block.name }, "Tool threw");
      return { content: JSON.stringify({ error: "Internal error while running this tool." }), isError: true };
    }
  }

  /**
   * Rebuilds the model-facing history from stored messages. Only text is stored,
   * so earlier turns carry no thinking blocks to invalidate.
   */
  async function loadHistory(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
    const rows = await db.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: historyLimit,
    });
    rows.reverse();

    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const row of rows) {
      const role = row.role === "CUSTOMER" ? "user" : "assistant";
      const text = row.role === "AGENT" ? `(Reply from staff) ${row.text}` : row.text;
      const last = messages.at(-1);
      if (last?.role === role && typeof last.content === "string") {
        last.content += `\n\n${text}`;
      } else if (messages.length || role === "user") {
        // The API requires the first message to be from the user.
        messages.push({ role, content: text });
      }
    }
    return messages;
  }

  async function flagForStaff(ctx: ToolContext) {
    await db.conversation.update({ where: { id: ctx.conversationId }, data: { needsAttention: true } });
  }

  return { handleIncomingMessage };
}

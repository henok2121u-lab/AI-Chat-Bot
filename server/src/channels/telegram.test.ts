import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ConversationEngine } from "../engine/conversation.js";
import { encryptSecret } from "../lib/crypto.js";
import { createPrismaClient } from "../lib/db.js";
import { KeyedQueue } from "../lib/keyed-queue.js";
import { createTestRestaurant, engineWith, say, scriptedAi, silentLogger } from "../test/helpers.js";
import type { TelegramApi } from "./telegram.js";

const db = createPrismaClient();
const SECRET = "test-webhook-secret_123";
const TOKEN = "123456:TEST-TOKEN";
let businessId: string;

beforeAll(async () => {
  const { business } = await createTestRestaurant(db);
  businessId = business.id;
  await db.business.update({
    where: { id: businessId },
    data: { telegramBotToken: encryptSecret(TOKEN), telegramWebhookSecret: encryptSecret(SECRET) },
  });
});

afterAll(async () => {
  await db.business.deleteMany({ where: { id: businessId } });
  await db.$disconnect();
});

/** App wired with a scripted AI and a fake Telegram API that records what the bot sends. */
function setup(engine: ConversationEngine) {
  const sent: { chatId: number | string; text: string }[] = [];
  const tokens: string[] = [];
  const api = {
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId, text });
      return {} as never;
    },
    sendChatAction: async () => true as const,
  } as unknown as TelegramApi;
  const queue = new KeyedQueue((err) => {
    throw err;
  });
  const app = createApp({
    telegram: {
      db,
      engine,
      logger: silentLogger,
      queue,
      createApi: (token) => {
        tokens.push(token);
        return api;
      },
    },
  });
  return { app, queue, sent, tokens };
}

let nextId = 1000;
function textUpdate(chatId: number, text: string, messageId = nextId++) {
  return {
    update_id: nextId++,
    message: {
      message_id: messageId,
      date: 1_760_000_000,
      chat: { id: chatId, type: "private", first_name: "Abebe" },
      from: { id: chatId, is_bot: false, first_name: "Abebe", last_name: "Kebede" },
      text,
    },
  };
}

function post(app: ReturnType<typeof createApp>, body: object, secret = SECRET, id = businessId) {
  return request(app)
    .post(`/webhooks/telegram/${id}`)
    .set("X-Telegram-Bot-Api-Secret-Token", secret)
    .send(body);
}

describe("Telegram webhook", () => {
  it("rejects requests without the right secret token", async () => {
    const ai = scriptedAi([]);
    const { app } = setup(engineWith(db, ai.client));

    await post(app, textUpdate(1, "hi"), "wrong-secret").expect(401);
    await request(app).post(`/webhooks/telegram/${businessId}`).send(textUpdate(1, "hi")).expect(401);
    expect(ai.calls).toHaveLength(0);
  });

  it("returns 404 for a business without a connected bot", async () => {
    const { app } = setup(engineWith(db, scriptedAi([]).client));
    await post(app, textUpdate(1, "hi"), SECRET, "no-such-business").expect(404);
  });

  it("answers a text message through the bot API, using the decrypted token", async () => {
    const ai = scriptedAi([say("Selam Abebe! How can I help?")]);
    const { app, queue, sent, tokens } = setup(engineWith(db, ai.client));

    await post(app, textUpdate(555, "Do you have shiro?")).expect(200);
    await queue.drain();

    expect(sent).toEqual([{ chatId: "555", text: "Selam Abebe! How can I help?" }]);
    expect(tokens).toEqual([TOKEN]);
    expect(ai.calls[0]!.messages).toEqual([{ role: "user", content: "Do you have shiro?" }]);

    const customer = await db.customer.findFirstOrThrow({ where: { businessId, externalId: "555" } });
    expect(customer).toMatchObject({ channel: "TELEGRAM", name: "Abebe Kebede" });
  });

  it("drops a retried update with the same message id", async () => {
    const ai = scriptedAi([say("Hello!")]);
    const { app, queue, sent } = setup(engineWith(db, ai.client));
    const update = textUpdate(556, "hello");

    await post(app, update).expect(200);
    await post(app, update).expect(200);
    await queue.drain();

    expect(ai.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("turns /start into a greeting for the bot", async () => {
    const ai = scriptedAi([say("Welcome!")]);
    const { app, queue } = setup(engineWith(db, ai.client));

    await post(app, textUpdate(557, "/start")).expect(200);
    await queue.drain();

    expect(ai.calls[0]!.messages).toEqual([{ role: "user", content: "Hi!" }]);
  });

  it("replies with a text-only notice for photos, stickers and voice notes", async () => {
    const ai = scriptedAi([]);
    const { app, queue, sent } = setup(engineWith(db, ai.client));
    const update = textUpdate(558, "");
    const { text: _text, ...photoMessage } = update.message;

    await post(app, { ...update, message: { ...photoMessage, photo: [{ file_id: "x", file_unique_id: "y", width: 1, height: 1 }] } }).expect(200);
    await queue.drain();

    expect(ai.calls).toHaveLength(0);
    expect(sent[0]!.text).toMatch(/only read text messages/);
  });

  it("ignores group chats", async () => {
    const ai = scriptedAi([]);
    const { app, queue, sent } = setup(engineWith(db, ai.client));
    const update = textUpdate(-100123, "hi everyone");

    await post(app, { ...update, message: { ...update.message, chat: { id: -100123, type: "group", title: "Friends" } } }).expect(200);
    await queue.drain();

    expect(ai.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("keeps replies in order when a customer sends several messages quickly", async () => {
    const ai = scriptedAi([say("first reply"), say("second reply")]);
    const { app, queue, sent } = setup(engineWith(db, ai.client));

    await Promise.all([post(app, textUpdate(559, "one")).expect(200), post(app, textUpdate(559, "two")).expect(200)]);
    await queue.drain();

    expect(sent.map((s) => s.text)).toEqual(["first reply", "second reply"]);
    // The second model call saw the first exchange.
    expect(ai.calls[1]!.messages.length).toBeGreaterThan(1);
  });
});

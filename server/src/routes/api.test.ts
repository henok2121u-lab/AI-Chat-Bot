import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { OutboundSender } from "../channels/outbound.js";
import { hashPassword, SESSION_COOKIE } from "../lib/auth.js";
import { createPrismaClient } from "../lib/db.js";
import { KeyedQueue } from "../lib/keyed-queue.js";
import { engineWith, scriptedAi, silentLogger } from "../test/helpers.js";

const db = createPrismaClient();
const sent: Parameters<OutboundSender>[] = [];
const app = createApp({
  api: { db, sendToCustomer: async (...args) => void sent.push(args) },
  telegram: { db, engine: engineWith(db, scriptedAi([]).client), logger: silentLogger, queue: new KeyedQueue() },
});

const createdEmails: string[] = [];

/** Registers a fresh business and returns a supertest agent that keeps its session cookie. */
async function registerBusiness(name = "Test Cafe") {
  const agent = request.agent(app);
  const email = `owner-${randomUUID()}@test.dev`;
  createdEmails.push(email);
  const res = await agent
    .post("/api/auth/register")
    .send({ businessName: name, name: "Owner", email, password: "correct-horse-1" })
    .expect(201);
  return { agent, email, businessId: res.body.business.id as string, res };
}

let a: Awaited<ReturnType<typeof registerBusiness>>;
let b: Awaited<ReturnType<typeof registerBusiness>>;

beforeAll(async () => {
  a = await registerBusiness("Cafe A");
  b = await registerBusiness("Cafe B");
});

afterAll(async () => {
  const users = await db.user.findMany({ where: { email: { in: createdEmails } }, select: { businessId: true } });
  await db.business.deleteMany({ where: { id: { in: users.map((u) => u.businessId) } } });
  await db.$disconnect();
});

describe("auth", () => {
  it("registers a business and sets an httpOnly session cookie", async () => {
    const cookie = a.res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(a.res.body.user).not.toHaveProperty("passwordHash");

    const me = await a.agent.get("/api/auth/me").expect(200);
    expect(me.body).toMatchObject({ user: { email: a.email, role: "OWNER" }, business: { name: "Cafe A" } });
  });

  it("rejects a duplicate email", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ businessName: "Again", name: "X", email: a.email.toUpperCase(), password: "correct-horse-1" })
      .expect(409);
  });

  it("logs in with the right password only (email is case-insensitive)", async () => {
    await request(app).post("/api/auth/login").send({ email: a.email, password: "wrong-password" }).expect(401);
    await request(app).post("/api/auth/login").send({ email: "nobody@test.dev", password: "whatever-1" }).expect(401);
    const ok = await request(app).post("/api/auth/login").send({ email: a.email.toUpperCase(), password: "correct-horse-1" }).expect(200);
    expect(ok.headers["set-cookie"]?.[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
  });

  it("requires a valid session for the API", async () => {
    await request(app).get("/api/menu-items").expect(401);
    await request(app).get("/api/menu-items").set("Cookie", `${SESSION_COOKIE}=not-a-jwt`).expect(401);
  });

  it("logs out", async () => {
    const { agent } = await registerBusiness();
    await agent.post("/api/auth/logout").expect(204);
    await agent.get("/api/auth/me").expect(401);
  });

  it("rejects non-JSON bodies (CSRF guard)", async () => {
    await a.agent.post("/api/faqs").type("form").send("question=a&answer=b").expect(415);
  });
});

describe("knowledge", () => {
  it("creates, updates and deletes menu items", async () => {
    const created = await a.agent
      .post("/api/menu-items")
      .send({ name: "Shiro", price: 320, category: "Fasting" })
      .expect(201);
    expect(created.body).toMatchObject({ name: "Shiro", price: "320", available: true, businessId: a.businessId });

    await a.agent.patch(`/api/menu-items/${created.body.id}`).send({ available: false }).expect(200);
    // A partial update must not reset other fields.
    const renamed = await a.agent.patch(`/api/menu-items/${created.body.id}`).send({ name: "Shiro Tegabino" }).expect(200);
    expect(renamed.body).toMatchObject({ name: "Shiro Tegabino", available: false, price: "320" });

    const list = await a.agent.get("/api/menu-items").expect(200);
    expect(list.body.map((m: { name: string }) => m.name)).toContain("Shiro Tegabino");

    await a.agent.delete(`/api/menu-items/${created.body.id}`).expect(204);
    await a.agent.delete(`/api/menu-items/${created.body.id}`).expect(404);
  });

  it("validates input", async () => {
    const res = await a.agent.post("/api/menu-items").send({ name: "", price: -5, category: "X" }).expect(400);
    expect(res.body.error).toBeTruthy();
    await a.agent.patch("/api/menu-items/whatever").send({ businessId: b.businessId }).expect(400); // unknown field
  });

  it("keeps each business's data private", async () => {
    const item = await a.agent.post("/api/menu-items").send({ name: "Secret Tibs", price: 900, category: "Meat" }).expect(201);
    const faq = await a.agent.post("/api/faqs").send({ question: "Parking?", answer: "Yes" }).expect(201);

    const bList = await b.agent.get("/api/menu-items").expect(200);
    expect(bList.body.find((m: { id: string }) => m.id === item.body.id)).toBeUndefined();

    await b.agent.patch(`/api/menu-items/${item.body.id}`).send({ price: 1 }).expect(404);
    await b.agent.delete(`/api/menu-items/${item.body.id}`).expect(404);
    await b.agent.delete(`/api/faqs/${faq.body.id}`).expect(404);

    const still = await db.menuItem.findUniqueOrThrow({ where: { id: item.body.id } });
    expect(still.price.toString()).toBe("900");
  });

  it("manages services and FAQs", async () => {
    const service = await a.agent.post("/api/services").send({ name: "Haircut", durationMin: 30, price: "250.50" }).expect(201);
    expect(service.body).toMatchObject({ price: "250.5", durationMin: 30 });
    const faq = await a.agent.post("/api/faqs").send({ question: "Wi-Fi?", answer: "Free" }).expect(201);
    await a.agent.patch(`/api/faqs/${faq.body.id}`).send({ answer: "Free for guests" }).expect(200);
    const faqs = await a.agent.get("/api/faqs").expect(200);
    expect(faqs.body.find((f: { id: string }) => f.id === faq.body.id).answer).toBe("Free for guests");
  });
});

describe("business settings", () => {
  it("returns settings without channel secrets", async () => {
    await db.business.update({ where: { id: a.businessId }, data: { telegramBotToken: "v1:secret", telegramBotUsername: "cafe_a_bot" } });
    const res = await a.agent.get("/api/business").expect(200);
    expect(JSON.stringify(res.body)).not.toContain("v1:secret");
    expect(res.body).not.toHaveProperty("telegramBotToken");
    expect(res.body).not.toHaveProperty("telegramWebhookSecret");
    expect(res.body.channels.telegram).toEqual({ connected: true, botUsername: "cafe_a_bot" });
  });

  it("updates hours, delivery pricing and the bot switch", async () => {
    const res = await a.agent
      .patch("/api/business")
      .send({ hours: { mon: [{ open: "08:00", close: "20:00" }] }, deliveryFee: 80, freeDeliveryThreshold: null, botEnabled: false })
      .expect(200);
    expect(res.body).toMatchObject({ deliveryFee: "80", freeDeliveryThreshold: null, botEnabled: false, hours: { mon: [{ open: "08:00", close: "20:00" }] } });

    await a.agent.patch("/api/business").send({ hours: { mon: [{ open: "8am", close: "8pm" }] } }).expect(400);
    await a.agent.patch("/api/business").send({ timezone: "Mars/Olympus" }).expect(400);
  });

  it("only lets the owner change settings", async () => {
    const email = `staff-${randomUUID()}@test.dev`;
    await db.user.create({ data: { email, name: "Staff", role: "STAFF", businessId: a.businessId, passwordHash: await hashPassword("staff-pass-1") } });
    const staff = request.agent(app);
    await staff.post("/api/auth/login").send({ email, password: "staff-pass-1" }).expect(200);

    await staff.get("/api/business").expect(200);
    await staff.patch("/api/business").send({ name: "Hijacked" }).expect(403);
    await staff.post("/api/menu-items").send({ name: "Tea", price: 40, category: "Drinks" }).expect(201);
  });
});

describe("conversations", () => {
  async function seedConversation(businessId: string, opts: { needsAttention?: boolean; mode?: "BOT" | "HUMAN"; lastMessageAt?: Date } = {}) {
    const customer = await db.customer.create({
      data: { businessId, channel: "TELEGRAM", externalId: `tg-${randomUUID()}`, name: "Abebe" },
    });
    const conversation = await db.conversation.create({
      data: {
        businessId,
        customerId: customer.id,
        channel: "TELEGRAM",
        needsAttention: opts.needsAttention ?? false,
        mode: opts.mode ?? "BOT",
        handoffReason: opts.mode === "HUMAN" ? "asked for a manager" : null,
        lastMessageAt: opts.lastMessageAt ?? new Date(),
      },
    });
    await db.message.createMany({
      data: [
        { conversationId: conversation.id, role: "CUSTOMER", text: "Hi", createdAt: new Date(Date.now() - 2000) },
        { conversationId: conversation.id, role: "BOT", text: "Selam! How can I help?", createdAt: new Date(Date.now() - 1000) },
      ],
    });
    return { customer, conversation };
  }

  it("lists conversations needing attention first, with a last-message preview", async () => {
    const recent = await seedConversation(a.businessId, { lastMessageAt: new Date() });
    const flagged = await seedConversation(a.businessId, { needsAttention: true, lastMessageAt: new Date(Date.now() - 60_000) });

    const res = await a.agent.get("/api/conversations").expect(200);
    const ids = res.body.map((c: { id: string }) => c.id);
    expect(ids.indexOf(flagged.conversation.id)).toBeLessThan(ids.indexOf(recent.conversation.id));
    expect(res.body[0].lastMessage).toMatchObject({ role: "BOT", text: "Selam! How can I help?" });

    const onlyFlagged = await a.agent.get("/api/conversations?filter=attention").expect(200);
    expect(onlyFlagged.body.every((c: { needsAttention: boolean }) => c.needsAttention)).toBe(true);
  });

  it("shows a conversation with its messages, and hides it from other businesses", async () => {
    const { conversation } = await seedConversation(a.businessId);
    const res = await a.agent.get(`/api/conversations/${conversation.id}`).expect(200);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(["Hi", "Selam! How can I help?"]);
    expect(res.body.customer).not.toHaveProperty("externalId");

    await b.agent.get(`/api/conversations/${conversation.id}`).expect(404);
    await b.agent.post(`/api/conversations/${conversation.id}/messages`).send({ text: "hi" }).expect(404);
  });

  it("sends a staff reply through the channel and pauses the bot", async () => {
    const { conversation, customer } = await seedConversation(a.businessId, { needsAttention: true });
    sent.length = 0;

    const res = await a.agent.post(`/api/conversations/${conversation.id}/messages`).send({ text: "Hi, this is Selam from the kitchen." }).expect(201);
    expect(res.body).toMatchObject({ role: "AGENT", text: "Hi, this is Selam from the kitchen." });
    expect(sent).toEqual([
      [{ businessId: a.businessId, channel: "TELEGRAM", externalUserId: customer.externalId }, "Hi, this is Selam from the kitchen."],
    ]);

    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after).toMatchObject({ mode: "HUMAN", needsAttention: false });

    const polled = await a.agent.get(`/api/conversations/${conversation.id}/messages?after=${encodeURIComponent(new Date(Date.now() - 500).toISOString())}`).expect(200);
    expect(polled.body.map((m: { role: string }) => m.role)).toEqual(["AGENT"]);
  });

  it("hands a conversation back to the bot", async () => {
    const { conversation } = await seedConversation(a.businessId, { mode: "HUMAN", needsAttention: true });
    const res = await a.agent.patch(`/api/conversations/${conversation.id}`).send({ mode: "BOT" }).expect(200);
    expect(res.body).toMatchObject({ mode: "BOT", needsAttention: false, handoffReason: null });
  });
});

describe("orders and bookings", () => {
  async function seedOrder(businessId: string) {
    const customer = await db.customer.create({ data: { businessId, channel: "TELEGRAM", externalId: `tg-${randomUUID()}`, name: "Sara" } });
    return db.order.create({
      data: {
        businessId,
        customerId: customer.id,
        items: [{ itemId: "x", name: "Doro Wat", unitPrice: "950", quantity: 1 }],
        subtotal: 950,
        total: 1050,
        deliveryFee: 100,
        deliveryType: "DELIVERY",
        address: "Bole",
      },
    });
  }

  it("moves an order through its statuses and rejects invalid jumps", async () => {
    const order = await seedOrder(a.businessId);

    const list = await a.agent.get("/api/orders?status=NEW").expect(200);
    expect(list.body.find((o: { id: string }) => o.id === order.id)).toMatchObject({ total: "1050", customer: { name: "Sara" } });

    await a.agent.patch(`/api/orders/${order.id}`).send({ status: "CONFIRMED" }).expect(200);
    const active = await a.agent.get("/api/orders?status=NEW,CONFIRMED,READY").expect(200);
    expect(active.body.map((o: { id: string }) => o.id)).toContain(order.id);
    const done = await a.agent.get("/api/orders?status=DELIVERED,CANCELLED").expect(200);
    expect(done.body.map((o: { id: string }) => o.id)).not.toContain(order.id);
    await a.agent.get("/api/orders?status=NEW,BOGUS").expect(400);
    const bad = await a.agent.patch(`/api/orders/${order.id}`).send({ status: "DELIVERED" }).expect(409);
    expect(bad.body.error).toMatch(/CONFIRMED to DELIVERED/);
    await a.agent.patch(`/api/orders/${order.id}`).send({ status: "READY" }).expect(200);
    await a.agent.patch(`/api/orders/${order.id}`).send({ status: "DELIVERED" }).expect(200);
    await a.agent.patch(`/api/orders/${order.id}`).send({ status: "CANCELLED" }).expect(409);
  });

  it("doesn't let another business see or change an order", async () => {
    const order = await seedOrder(a.businessId);
    await b.agent.get(`/api/orders/${order.id}`).expect(404);
    await b.agent.patch(`/api/orders/${order.id}`).send({ status: "CANCELLED" }).expect(404);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("NEW");
  });

  it("lists upcoming bookings and updates their status", async () => {
    const customer = await db.customer.create({ data: { businessId: a.businessId, channel: "TELEGRAM", externalId: `tg-${randomUUID()}` } });
    const base = { businessId: a.businessId, customerId: customer.id, partySize: 4, contactName: "Sara", contactPhone: "0922000000" };
    const upcoming = await db.booking.create({ data: { ...base, startsAt: new Date(Date.now() + 86_400_000), status: "CONFIRMED" } });
    const old = await db.booking.create({ data: { ...base, startsAt: new Date(Date.now() - 7 * 86_400_000), status: "COMPLETED" } });

    const res = await a.agent.get("/api/bookings").expect(200);
    const ids = res.body.map((x: { id: string }) => x.id);
    expect(ids).toContain(upcoming.id);
    expect(ids).not.toContain(old.id);

    const ranged = await a.agent.get(`/api/bookings?from=${new Date(Date.now() - 30 * 86_400_000).toISOString()}`).expect(200);
    expect(ranged.body.map((x: { id: string }) => x.id)).toContain(old.id);

    await a.agent.patch(`/api/bookings/${upcoming.id}`).send({ status: "NO_SHOW" }).expect(200);
    await a.agent.patch(`/api/bookings/${upcoming.id}`).send({ status: "CONFIRMED" }).expect(409);
    await b.agent.patch(`/api/bookings/${old.id}`).send({ status: "CANCELLED" }).expect(404);
  });
});

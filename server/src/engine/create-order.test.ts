import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../lib/db.js";
import {
  captureSender,
  createTestRestaurant,
  engineWith,
  incoming,
  resultJson,
  say,
  scriptedAi,
  toolResultsSentOn,
  toolUse,
} from "../test/helpers.js";

const db = createPrismaClient();
let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
const businessIds: string[] = [];

beforeAll(async () => {
  restaurant = await createTestRestaurant(db);
  businessIds.push(restaurant.business.id);
});

afterAll(async () => {
  await db.business.deleteMany({ where: { id: { in: businessIds } } });
  await db.$disconnect();
});

/** Runs one customer message through the engine where the model calls create_order once, then replies. */
async function orderVia(input: Record<string, unknown>, opts: { now?: Date; businessId?: string } = {}) {
  const ai = scriptedAi([toolUse("create_order", input), say("Done! Your order is placed.")]);
  const { sender, sent } = captureSender();
  const msg = incoming(opts.businessId ?? restaurant.business.id, "Yes, please place the order.");
  const result = await engineWith(db, ai.client, opts.now).handleIncomingMessage(msg, sender);

  const [toolResult] = toolResultsSentOn(ai.calls[1]!);
  const customer = await db.customer.findFirstOrThrow({ where: { externalId: msg.externalUserId } });
  const orders = await db.order.findMany({ where: { customerId: customer.id } });
  return { ai, sent, result, toolResult: toolResult!, body: resultJson(toolResult!), orders, customer };
}

describe("create_order", () => {
  it("creates the order with totals computed from DB prices, ignoring any total from the model", async () => {
    const { doroWat, injera } = restaurant.menu;
    const { body, toolResult, orders, sent, result, ai, customer } = await orderVia({
      items: [
        { itemId: doroWat.id, quantity: 2, notes: "extra spicy" },
        { itemId: injera.id, quantity: 1 },
      ],
      deliveryType: "delivery",
      address: "Bole, near Edna Mall",
      phone: "+251900000001",
      total: 5, // the model has no say in money — must be ignored
    });

    // 2 × 950 + 40 = 1940 subtotal, below the 2000 free-delivery threshold → +100 fee
    expect(toolResult.is_error).toBeFalsy();
    expect(body).toMatchObject({ subtotal: "1940", deliveryFee: "100", total: "2040", currency: "ETB", status: "NEW" });
    expect(body.items).toEqual([
      { name: "Doro Wat", quantity: 2, unitPrice: "950", lineTotal: "1900", notes: "extra spicy" },
      { name: "Extra Injera", quantity: 1, unitPrice: "40", lineTotal: "40" },
    ]);

    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    expect(order.total.toString()).toBe("2040");
    expect(order.subtotal.toString()).toBe("1940");
    expect(order.deliveryType).toBe("DELIVERY");
    expect(order.address).toBe("Bole, near Edna Mall");
    expect(order.businessId).toBe(restaurant.business.id);
    expect(body.orderNumber).toBe(order.number);

    // Phone is remembered on the customer for next time.
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).phone).toBe("+251900000001");

    // The model's final text is what gets saved and sent.
    expect(result).toMatchObject({ status: "replied", reply: "Done! Your order is placed." });
    expect(sent).toEqual([{ to: expect.any(String), text: "Done! Your order is placed." }]);
    expect(ai.calls).toHaveLength(2);
  });

  it("makes delivery free at or above the threshold", async () => {
    const { body } = await orderVia({
      items: [{ itemId: restaurant.menu.doroWat.id, quantity: 3 }],
      deliveryType: "delivery",
      address: "Kazanchis",
      phone: "+251900000002",
    });
    expect(body).toMatchObject({ subtotal: "2850", deliveryFee: "0", total: "2850" });
  });

  it("charges no delivery fee for pickup and merges repeated lines for the same item", async () => {
    const { injera } = restaurant.menu;
    const { body, orders } = await orderVia({
      items: [
        { itemId: injera.id, quantity: 1 },
        { itemId: injera.id, quantity: 2 },
      ],
      deliveryType: "pickup",
    });
    expect(body).toMatchObject({ subtotal: "120", deliveryFee: "0", total: "120" });
    expect(orders[0]!.items).toEqual([{ itemId: injera.id, name: "Extra Injera", unitPrice: "40", quantity: 3 }]);
  });

  it("rejects item ids that are not on the menu", async () => {
    const { toolResult, body, orders } = await orderVia({
      items: [{ itemId: "made-up-item", quantity: 1 }],
      deliveryType: "pickup",
    });
    expect(toolResult.is_error).toBe(true);
    expect(body.error).toContain("made-up-item");
    expect(orders).toHaveLength(0);
  });

  it("rejects menu items that belong to another business", async () => {
    const other = await createTestRestaurant(db);
    businessIds.push(other.business.id);

    const { toolResult, orders } = await orderVia({
      items: [{ itemId: other.menu.doroWat.id, quantity: 1 }],
      deliveryType: "pickup",
    });
    expect(toolResult.is_error).toBe(true);
    expect(orders).toHaveLength(0);
  });

  it("rejects items marked unavailable", async () => {
    const { toolResult, body, orders } = await orderVia({
      items: [{ itemId: restaurant.menu.goredGored.id, quantity: 1 }],
      deliveryType: "pickup",
    });
    expect(toolResult.is_error).toBe(true);
    expect(body.error).toContain("Gored Gored");
    expect(orders).toHaveLength(0);
  });

  it("requires an address and phone for delivery", async () => {
    const { toolResult, body, orders } = await orderVia({
      items: [{ itemId: restaurant.menu.doroWat.id, quantity: 1 }],
      deliveryType: "delivery",
    });
    expect(toolResult.is_error).toBe(true);
    expect(body.error).toMatch(/address/i);
    expect(orders).toHaveLength(0);
  });

  it("enforces the minimum delivery order", async () => {
    const { toolResult, body, orders } = await orderVia({
      items: [{ itemId: restaurant.menu.injera.id, quantity: 2 }],
      deliveryType: "delivery",
      address: "Gerji",
      phone: "+251900000003",
    });
    expect(toolResult.is_error).toBe(true);
    expect(body.error).toContain("400");
    expect(orders).toHaveLength(0);
  });

  it("rejects invalid quantities", async () => {
    const { toolResult, orders } = await orderVia({
      items: [{ itemId: restaurant.menu.doroWat.id, quantity: 0 }],
      deliveryType: "pickup",
    });
    expect(toolResult.is_error).toBe(true);
    expect(orders).toHaveLength(0);
  });

  it("refuses orders while the business is closed", async () => {
    // 02:00 in Addis Ababa
    const { toolResult, body, orders } = await orderVia(
      { items: [{ itemId: restaurant.menu.doroWat.id, quantity: 1 }], deliveryType: "pickup" },
      { now: new Date("2026-10-06T23:00:00Z") },
    );
    expect(toolResult.is_error).toBe(true);
    expect(body.error).toMatch(/closed/i);
    expect(orders).toHaveLength(0);
  });
});

describe("conversation engine", () => {
  it("sends the menu with ids and prices in the system prompt", async () => {
    const ai = scriptedAi([say("Selam! How can I help?")]);
    await engineWith(db, ai.client).handleIncomingMessage(incoming(restaurant.business.id, "Hi"), captureSender().sender);

    const system = ai.calls[0]!.system as { text: string }[];
    expect(system[0]!.text).toContain(`[id: ${restaurant.menu.doroWat.id}] Doro Wat — 950 ETB`);
    expect(system[0]!.text).toContain("Gored Gored — 1000 ETB (UNAVAILABLE today)");
    expect(system[1]!.text).toContain("currently OPEN");
  });

  it("does not call the AI when a human has taken over the conversation", async () => {
    const msg = incoming(restaurant.business.id, "Hello?");
    const first = scriptedAi([toolUse("handoff_to_human", { reason: "customer asked for a manager" }), say("Connecting you with our staff.")]);
    await engineWith(db, first.client).handleIncomingMessage(msg, captureSender().sender);

    const second = scriptedAi([]);
    const { sender, sent } = captureSender();
    const result = await engineWith(db, second.client).handleIncomingMessage({ ...msg, text: "Anyone there?" }, sender);

    expect(result.status).toBe("human_mode");
    expect(second.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const convo = await db.conversation.findUniqueOrThrow({ where: { id: (result as { conversationId: string }).conversationId } });
    expect(convo).toMatchObject({ mode: "HUMAN", needsAttention: true, handoffReason: "customer asked for a manager" });
  });

  it("ignores a webhook retry with the same external message id", async () => {
    const msg = incoming(restaurant.business.id, "Menu please", { externalMessageId: "tg-msg-1" });
    const ai = scriptedAi([say("Here's our menu…")]);
    const engine = engineWith(db, ai.client);

    await engine.handleIncomingMessage(msg, captureSender().sender);
    const retry = await engine.handleIncomingMessage(msg, captureSender().sender);

    expect(retry.status).toBe("duplicate");
    expect(ai.calls).toHaveLength(1);
  });

  it("falls back to a staff handoff message when the AI call fails", async () => {
    const failing = { createMessage: async () => Promise.reject(new Error("network down")) };
    const { sender, sent } = captureSender();
    const result = await engineWith(db, failing).handleIncomingMessage(incoming(restaurant.business.id, "Hi"), sender);

    expect(result.status).toBe("replied");
    expect(sent[0]!.text).toMatch(/staff/i);
    const convo = await db.conversation.findUniqueOrThrow({ where: { id: (result as { conversationId: string }).conversationId } });
    expect(convo.needsAttention).toBe(true);
  });
});

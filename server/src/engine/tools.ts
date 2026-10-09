import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { isOpenFor, parseHours, toLocal, zonedToUtc } from "../lib/time.js";

export interface ToolContext {
  db: PrismaClient;
  businessId: string;
  customerId: string;
  conversationId: string;
  now: Date;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Definitions sent to Claude. Hand-written JSON Schema (kept to keywords that
// strict tool use accepts); the zod schemas below re-validate every call.
// ---------------------------------------------------------------------------

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: "create_order",
    description:
      "Place a food order for the customer. Only call this after you have read the full order back to the customer and they confirmed it. Use menu item ids from the system prompt. The server calculates prices and the total.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Ordered menu items.",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string", description: "Menu item id from the menu list." },
              quantity: { type: "integer", description: "How many (1-50)." },
              notes: { type: "string", description: "Optional preparation notes, e.g. 'leb leb', 'no onions'." },
            },
            required: ["itemId", "quantity"],
            additionalProperties: false,
          },
        },
        deliveryType: { type: "string", enum: ["pickup", "delivery", "dine_in"] },
        address: { type: "string", description: "Delivery address. Required for delivery." },
        phone: { type: "string", description: "Customer phone number. Required for delivery." },
      },
      required: ["items", "deliveryType"],
      additionalProperties: false,
    },
  },
  {
    name: "create_booking",
    description:
      "Book a table (restaurants) or an appointment (services) for the customer. Dates and times are in the business's local timezone.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "Service id, for appointment-based businesses. Omit for table bookings." },
        date: { type: "string", description: "Local date, YYYY-MM-DD." },
        time: { type: "string", description: "Local start time, 24h HH:MM." },
        partySize: { type: "integer", description: "Number of people. Defaults to 1." },
        name: { type: "string", description: "Name the booking is under." },
        phone: { type: "string", description: "Contact phone number." },
      },
      required: ["date", "time", "name", "phone"],
      additionalProperties: false,
    },
  },
  {
    name: "check_order_status",
    description:
      "Look up this customer's orders. Pass the order number if the customer gave one; omit it to list their most recent orders.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        orderNumber: { type: "integer", description: "Order number, e.g. 1042 for 'order #1042'." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Hand the conversation to a staff member. The bot stops replying in this chat until staff hand it back.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short reason for staff, e.g. 'customer asked for a manager'." },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const createOrderInput = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().max(200).optional(),
      }),
    )
    .min(1, "Order must contain at least one item"),
  deliveryType: z.enum(["pickup", "delivery", "dine_in"]),
  address: z.string().trim().min(1).max(300).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
});

const createBookingInput = z.object({
  serviceId: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)"),
  partySize: z.number().int().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(30),
});

const checkOrderStatusInput = z.object({
  orderNumber: z.number().int().positive().optional(),
});

const handoffInput = z.object({
  reason: z.string().trim().min(1).max(500),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const ok = (data: unknown): ToolResult => ({ content: JSON.stringify(data) });
const fail = (error: string): ToolResult => ({ content: JSON.stringify({ error }), isError: true });

const DELIVERY_TYPE = { pickup: "PICKUP", delivery: "DELIVERY", dine_in: "DINE_IN" } as const;
const DEFAULT_TABLE_MINUTES = 60;
const MAX_BOOKING_DAYS_AHEAD = 60;

async function createOrder(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = createOrderInput.safeParse(raw);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  const input = parsed.data;
  const { db, businessId } = ctx;

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!isOpenFor(parseHours(business.hours), business.timezone, ctx.now)) {
    return fail("The business is closed right now, so orders can't be placed. Tell the customer the opening hours.");
  }

  // Merge repeated lines for the same item.
  const quantities = new Map<string, { quantity: number; notes: string[] }>();
  for (const line of input.items) {
    const entry = quantities.get(line.itemId) ?? { quantity: 0, notes: [] };
    entry.quantity += line.quantity;
    if (line.notes) entry.notes.push(line.notes);
    quantities.set(line.itemId, entry);
  }

  // Scoped to this business: ids from another tenant simply aren't found.
  const menuItems = await db.menuItem.findMany({
    where: { businessId, id: { in: [...quantities.keys()] } },
  });
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  const unknown = [...quantities.keys()].filter((id) => !byId.has(id));
  if (unknown.length) return fail(`Unknown menu item id(s): ${unknown.join(", ")}. Use ids from the menu.`);

  const unavailable = menuItems.filter((m) => !m.available).map((m) => m.name);
  if (unavailable.length) return fail(`Not available today: ${unavailable.join(", ")}. Ask the customer to choose something else.`);

  const lines = [...quantities].map(([itemId, { quantity, notes }]) => {
    const item = byId.get(itemId)!;
    return {
      itemId,
      name: item.name,
      unitPrice: item.price,
      quantity,
      lineTotal: item.price.mul(quantity),
      notes: notes.length ? notes.join("; ") : undefined,
    };
  });
  const subtotal = lines.reduce((sum, l) => sum.add(l.lineTotal), new Prisma.Decimal(0));

  let deliveryFee = new Prisma.Decimal(0);
  if (input.deliveryType === "delivery") {
    if (!input.address || !input.phone) {
      return fail("Delivery orders need both an address and a phone number. Ask the customer for the missing details.");
    }
    if (business.minDeliveryOrder && subtotal.lt(business.minDeliveryOrder)) {
      return fail(
        `Minimum order for delivery is ${business.minDeliveryOrder.toString()} ${business.currency}; this order is ${subtotal.toString()} ${business.currency}.`,
      );
    }
    const free = business.freeDeliveryThreshold && subtotal.gte(business.freeDeliveryThreshold);
    deliveryFee = free ? deliveryFee : business.deliveryFee;
  }
  const total = subtotal.add(deliveryFee);

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        businessId,
        customerId: ctx.customerId,
        conversationId: ctx.conversationId,
        status: "NEW",
        items: lines.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          unitPrice: l.unitPrice.toString(),
          quantity: l.quantity,
          ...(l.notes && { notes: l.notes }),
        })),
        subtotal,
        deliveryFee,
        total,
        deliveryType: DELIVERY_TYPE[input.deliveryType],
        address: input.address,
        phone: input.phone,
      },
    });
    if (input.phone) {
      await tx.customer.updateMany({
        where: { id: ctx.customerId, businessId, phone: null },
        data: { phone: input.phone },
      });
    }
    return created;
  });

  return ok({
    orderNumber: order.number,
    status: order.status,
    deliveryType: input.deliveryType,
    items: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toString(),
      lineTotal: l.lineTotal.toString(),
      ...(l.notes && { notes: l.notes }),
    })),
    subtotal: subtotal.toString(),
    deliveryFee: deliveryFee.toString(),
    total: total.toString(),
    currency: business.currency,
  });
}

async function createBooking(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = createBookingInput.safeParse(raw);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  const input = parsed.data;
  const { db, businessId } = ctx;

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });

  let service: { id: string; name: string; durationMin: number } | null = null;
  if (input.serviceId) {
    service = await db.service.findFirst({
      where: { id: input.serviceId, businessId, available: true },
      select: { id: true, name: true, durationMin: true },
    });
    if (!service) return fail(`Unknown or unavailable service id: ${input.serviceId}.`);
  }

  const startsAt = zonedToUtc(input.date, input.time, business.timezone);
  if (Number.isNaN(startsAt.getTime())) return fail("Invalid date or time.");
  // Round-trip check catches impossible dates like 2026-02-30.
  const local = toLocal(startsAt, business.timezone);
  if (local.date !== input.date || local.time !== input.time) return fail("That date/time doesn't exist.");
  if (startsAt <= ctx.now) return fail("That time is in the past. Ask for a future date and time.");
  if (startsAt.getTime() - ctx.now.getTime() > MAX_BOOKING_DAYS_AHEAD * 86_400_000) {
    return fail(`Bookings can be made at most ${MAX_BOOKING_DAYS_AHEAD} days ahead.`);
  }

  const durationMin = service?.durationMin ?? DEFAULT_TABLE_MINUTES;
  if (!isOpenFor(parseHours(business.hours), business.timezone, startsAt, durationMin)) {
    return fail(
      `We're not open for the full ${durationMin} minutes starting ${input.date} ${input.time}. Suggest a time within opening hours.`,
    );
  }

  // Simple capacity: count active bookings whose slot overlaps this one.
  const windowMs = durationMin * 60_000;
  const overlapping = await db.booking.count({
    where: {
      businessId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { gt: new Date(startsAt.getTime() - windowMs), lt: new Date(startsAt.getTime() + windowMs) },
      ...(service && { serviceId: service.id }),
    },
  });
  if (overlapping >= business.bookingSlotCapacity) {
    return fail("That time is fully booked. Suggest a different time.");
  }

  const booking = await db.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        businessId,
        customerId: ctx.customerId,
        conversationId: ctx.conversationId,
        serviceId: service?.id,
        startsAt,
        partySize: input.partySize ?? 1,
        contactName: input.name,
        contactPhone: input.phone,
        status: "CONFIRMED",
      },
    });
    await tx.customer.updateMany({
      where: { id: ctx.customerId, businessId },
      data: { phone: input.phone },
    });
    return created;
  });

  return ok({
    bookingId: booking.id,
    status: booking.status,
    date: input.date,
    time: input.time,
    partySize: booking.partySize,
    service: service?.name,
    name: input.name,
  });
}

async function checkOrderStatus(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = checkOrderStatusInput.safeParse(raw);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  const { orderNumber } = parsed.data;

  // Customers can only see their own orders at this business.
  const orders = await ctx.db.order.findMany({
    where: {
      businessId: ctx.businessId,
      customerId: ctx.customerId,
      ...(orderNumber !== undefined && { number: orderNumber }),
    },
    orderBy: { createdAt: "desc" },
    take: orderNumber !== undefined ? 1 : 3,
  });

  if (!orders.length) {
    return fail(orderNumber !== undefined ? `No order #${orderNumber} found for this customer.` : "This customer has no orders yet.");
  }

  return ok({
    orders: orders.map((o) => ({
      orderNumber: o.number,
      status: o.status,
      total: o.total.toString(),
      deliveryType: o.deliveryType,
      placedAt: o.createdAt.toISOString(),
      items: o.items,
    })),
  });
}

async function handoffToHuman(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = handoffInput.safeParse(raw);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  await ctx.db.conversation.update({
    where: { id: ctx.conversationId, businessId: ctx.businessId },
    data: { mode: "HUMAN", needsAttention: true, handoffReason: parsed.data.reason },
  });
  return ok({ handedOff: true, note: "Tell the customer briefly that a staff member will reply here soon." });
}

const handlers: Record<string, (input: unknown, ctx: ToolContext) => Promise<ToolResult>> = {
  create_order: createOrder,
  create_booking: createBooking,
  check_order_status: checkOrderStatus,
  handoff_to_human: handoffToHuman,
};

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return fail(`Unknown tool: ${name}`);
  return handler(input, ctx);
}

import type { PrismaClient } from "../generated/prisma/client.js";
import { formatHours, isOpenFor, parseHours, toLocal } from "../lib/time.js";

export async function loadBusinessKnowledge(db: PrismaClient, businessId: string) {
  return db.business.findUniqueOrThrow({
    where: { id: businessId },
    include: {
      menuItems: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      services: { orderBy: { name: "asc" } },
      faqs: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export type BusinessKnowledge = Awaited<ReturnType<typeof loadBusinessKnowledge>>;

const RULES = `
How to behave:
- You are the customer-support assistant for this business, chatting with customers on a messaging app. Speak as the business ("we").
- Answer only from the business information below. If something isn't covered, say you're not sure and offer to connect the customer with staff. Never invent items, prices, hours, policies or promises.
- Only offer menu items and services listed below. Items marked UNAVAILABLE can't be ordered today; suggest an alternative instead.
- Reply in the customer's language. Support at least English and Amharic: if they write in Amharic script (ፊደል), reply in Amharic script; if they write Amharic in Latin letters, reply the same way.
- Keep replies short and conversational, like a chat message, not an email. Plain text; no headings or tables. Short lists are fine.
- Prices are in the business's currency. When quoting a total, use the total returned by a tool, not your own arithmetic.

Orders:
- Collect the items and quantities, whether it's pickup, delivery or dine-in, and for delivery an address and phone number.
- Before calling create_order, repeat the full order back (items, quantities, pickup or delivery, address) and get a clear "yes" from the customer. Never call create_order without that confirmation.
- After create_order succeeds, give the customer the order number and the total from the tool result.
- Use check_order_status when a customer asks about an existing order.

Bookings:
- Collect date, time, number of people (or the service, for appointments), and the customer's name and phone number, then call create_booking. If it fails, explain why and suggest another time.

Handing off to a person — call handoff_to_human when:
- the customer asks for a person, manager or staff member;
- the customer is upset, angry or complaining;
- you're unsure how to answer, or the request is outside what you can do (refunds, large events, special arrangements).
After handing off, tell the customer briefly that a staff member will reply here soon.
`.trim();

/**
 * Stable part of the system prompt: depends only on the business's data, so it
 * stays byte-identical between turns and can be prompt-cached.
 */
export function buildKnowledgePrompt(b: BusinessKnowledge): string {
  const currency = b.currency;
  const sections: string[] = [RULES, `Business: ${b.name} (${b.type.toLowerCase()})`];

  if (b.description) sections.push(`About: ${b.description}`);
  const contact = [b.location && `Location: ${b.location}`, b.phone && `Phone: ${b.phone}`].filter(Boolean);
  if (contact.length) sections.push(contact.join("\n"));
  sections.push(`Opening hours (${b.timezone}):\n${formatHours(parseHours(b.hours))}`);
  if (b.policies) sections.push(`Policies:\n${b.policies}`);

  if (b.menuItems.length) {
    const byCategory = new Map<string, string[]>();
    for (const item of b.menuItems) {
      const line =
        `- [id: ${item.id}] ${item.name} — ${item.price.toString()} ${currency}` +
        (item.available ? "" : " (UNAVAILABLE today)") +
        (item.description ? `\n  ${item.description}` : "");
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), line]);
    }
    sections.push(
      `Menu (use the id when calling create_order):\n` +
        [...byCategory].map(([cat, lines]) => `${cat}:\n${lines.join("\n")}`).join("\n\n"),
    );
  }

  if (b.services.length) {
    sections.push(
      `Services (use the id when calling create_booking):\n` +
        b.services
          .map(
            (s) =>
              `- [id: ${s.id}] ${s.name} — ${s.durationMin} min, ${s.price.toString()} ${currency}` +
              (s.available ? "" : " (UNAVAILABLE)") +
              (s.description ? `\n  ${s.description}` : ""),
          )
          .join("\n"),
    );
  }

  if (b.faqs.length) {
    sections.push(`FAQs:\n` + b.faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n"));
  }

  return sections.join("\n\n");
}

/** Per-turn context (current time, who is chatting). Kept separate so it doesn't break the cache. */
export function buildTurnContext(
  b: Pick<BusinessKnowledge, "hours" | "timezone">,
  opts: { now: Date; customerName?: string | null; channel: string },
): string {
  const local = toLocal(opts.now, b.timezone);
  const open = isOpenFor(parseHours(b.hours), b.timezone, opts.now);
  return [
    `Current local time: ${local.weekday} ${local.date} ${local.time} (${b.timezone}). The business is currently ${open ? "OPEN" : "CLOSED"}.`,
    `Customer: ${opts.customerName ?? "unknown name"}, chatting via ${opts.channel.toLowerCase()}.`,
  ].join("\n");
}

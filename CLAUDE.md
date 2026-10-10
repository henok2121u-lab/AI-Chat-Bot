# SupportBot — AI customer-support bot for WhatsApp & Telegram

## What this is
A multi-tenant SaaS-style app. A small business (restaurant, clinic, salon) signs up, enters its menu/services, prices, hours and FAQs. An AI bot answers customers on Telegram and WhatsApp, takes orders or bookings, and hands the conversation to a human when it is unsure or the customer asks for one. Business staff use a web dashboard to see conversations, take over chats, manage orders/bookings, and edit the info the bot uses.

This is a portfolio project for Upwork. Code quality, a clean README, and a working demo matter as much as features.

## Stack
- Node.js 22+, TypeScript (ESM, NodeNext), Express 5
- PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`; config in `server/prisma.config.ts`; client generated to `server/src/generated/prisma`, import from `../generated/prisma/client.js`)
- AI: provider set by `AI_PROVIDER` — Google Gemini (`@google/genai`, default, `gemini-3.8-flash`) or Anthropic Claude (`@anthropic-ai/sdk`), both with tool/function calling
- Telegram Bot API (`grammy`)
- WhatsApp Cloud API (Meta Graph API, plain `fetch`)
- Dashboard: React + Vite + TypeScript + Tailwind, talking to the Express API
- Auth: email + password, bcrypt, JWT in httpOnly cookie
- Validation: zod. Logging: pino. Tests: vitest.
- Local dev: docker-compose for Postgres on host port 5434 (5432/5433 are taken on this machine); `.env` lives at the repo root; ngrok (or cloudflared) to expose webhooks

## Repo layout
```
/server
  /src
    /channels      telegram.ts, whatsapp.ts  (adapters: receive -> normalize, send)
    /engine        conversation.ts (core loop), prompt.ts, tools.ts
    /routes        auth, business, knowledge, conversations, orders, bookings, webhooks
    /lib           db.ts, ai.ts, logger.ts, env.ts
  /prisma          schema.prisma, seed.ts
/dashboard         React app
docker-compose.yml
.env.example
README.md
```

## Core architecture
1. A channel adapter receives a webhook/update and converts it to a normalized message:
   `{ businessId, channel: 'telegram'|'whatsapp', externalUserId, customerName?, text }`
2. `engine/conversation.ts`:
   - find or create Customer and Conversation
   - save the incoming Message
   - if conversation.mode === 'human' → do NOT call the AI; just notify the dashboard
   - else build the system prompt from the business's knowledge (name, hours, location, menu/services with prices, FAQs, policies) and the last ~20 messages, call Claude with tools
   - run any tool calls, loop until Claude returns a final text reply
   - save the bot reply and send it via the same adapter
3. The business knowledge is small enough to put directly in the system prompt. No vector DB / RAG for v1.

## AI tools (Claude tool use)
- `create_order({ items: [{ itemId, quantity, notes? }], deliveryType, address?, phone? })` — only items that exist in the menu; server recomputes subtotal, delivery fee (Business.deliveryFee / freeDeliveryThreshold / minDeliveryOrder) and total from DB prices, never trusts the model's math; refused while closed
- `create_booking({ serviceId?, date, time, partySize?, name, phone })` — check business hours and simple capacity
- `check_order_status({ orderNumber? })` — customer-facing order number (#1042); scoped to the current customer; omit to list their recent orders
- `handoff_to_human({ reason })` — sets conversation.mode = 'human', marks it as needing attention

System prompt rules: answer only from provided business info; never invent prices or items; confirm order details with the customer before calling create_order; hand off when unsure, when the customer is angry, or when asked for a person; reply in the customer's language (English and Amharic at minimum); keep replies short (chat, not email).

## Data model (Prisma, starting point)
- User (id, email, passwordHash, businessId, role)
- Business (id, name, type, hours JSON, location, phone, telegramBotToken?, whatsappPhoneNumberId?, whatsappAccessToken?, botEnabled)
- MenuItem (id, businessId, name, description, price, category, available)
- Service (id, businessId, name, durationMin, price) — for clinics/salons
- Faq (id, businessId, question, answer)
- Customer (id, businessId, channel, externalId, name, phone)
- Conversation (id, businessId, customerId, channel, mode 'bot'|'human', needsAttention, lastMessageAt)
- Message (id, conversationId, role 'customer'|'bot'|'agent', text, createdAt)
- Order (id, businessId, customerId, conversationId, status, items JSON, total, deliveryType, address, createdAt)
- Booking (id, businessId, customerId, conversationId, serviceId?, startsAt, partySize, status)

Secrets (bot tokens, WhatsApp tokens) must be encrypted at rest (AES-256-GCM with a key from env).

## Dashboard pages
- Login / register business
- Inbox: conversation list (needs-attention first), chat view, "Take over" / "Give back to bot" toggle, reply box (agent messages go out through the channel)
- Orders: list, status changes (new → confirmed → ready → delivered / cancelled)
- Bookings: list / simple calendar
- Knowledge: edit business info, menu items, services, FAQs
- Settings: connect Telegram (paste bot token → server calls setWebhook), connect WhatsApp (phone number ID + token), bot on/off
- Live updates: start with polling every 5s; Server-Sent Events later

## Channel notes
- Telegram: one bot token per business; webhook URL `/webhooks/telegram/:businessId` with secret_token header check. Implemented in `channels/telegram.ts` (grammy `Api` for sending; updates acked with 200 then processed via `KeyedQueue`, one at a time per chat). Private text messages only; `/start` becomes a greeting; non-text gets a text-only notice; groups ignored.
- WhatsApp Cloud API: webhook `/webhooks/whatsapp` (GET for verify token, POST for messages; verify X-Hub-Signature-256). Route to business by phone_number_id. Free-form replies only within 24h of the customer's last message; outside that, templates are needed — show this in the dashboard.

## Conventions
- Validate all input with zod. All DB queries scoped by businessId (no cross-tenant leaks).
- Respond 200 to webhooks quickly; process the message after.
- Deduplicate incoming messages by external message ID.
- No secrets in code; everything in `.env` (keep `.env.example` updated).
- Write small tests for the engine and tools using a mocked AI client.

## Build order
1. Server skeleton, Prisma schema, docker-compose, seed a demo restaurant
2. Conversation engine + Claude tools, tested with a local CLI chat (no channel yet)
3. Telegram adapter end to end
4. Auth + REST API
5. Dashboard: login, knowledge editor, inbox with takeover
6. Orders and bookings pages
7. WhatsApp adapter
8. Polish: README with screenshots and a demo GIF, deploy (Railway/Render + managed Postgres)

## Engine notes
- `AI_PROVIDER=gemini|anthropic` (default gemini), `AI_EFFORT` (default `medium`), `GEMINI_MODEL` / `ANTHROPIC_MODEL`. `createAiClient()` in `lib/ai.ts` picks the client.
- The engine speaks the Anthropic Messages shape (system/tools/tool_use/tool_result). `lib/gemini.ts` translates to and from Gemini `generateContent` (function calls, thought signatures, finish reasons, retries on 429/5xx). On Anthropic, requests use the beta Messages API with `fallbacks: "default"`.
- The engine depends on the `AiClient` interface (`lib/ai.ts`), so tests inject a scripted fake (`src/test/helpers.ts`).
- History sent to the model is rebuilt from stored text messages each turn; within a turn, assistant content (incl. thinking blocks) is appended unchanged. Keep it append-only — don't edit earlier turns mid-loop.
- System prompt = stable knowledge block (prompt-cached) + per-turn context block (current time, open/closed, customer).

## REST API (`/api`, implemented in `server/src/routes`)
- Auth (`routes/auth.ts`, `lib/auth.ts`): `POST /auth/register|login|logout`, `GET /auth/me`. JWT (jose, HS256, 7 days) in httpOnly SameSite=Lax cookie `sb_session`; login/register rate-limited. `requireAuth` re-loads the user and sets `req.auth = { userId, businessId, role }`.
- Every route takes businessId from `auth(req)`, never from the request. Scoped writes use `update/delete({ where: { id, businessId } })`; Prisma P2025 → 404, so other tenants' ids look like they don't exist.
- `GET/PATCH /business` (owner only for PATCH; never returns channel secrets; `channels.telegram.connected/botUsername`), `POST/DELETE /business/telegram` (connect via token; uses PUBLIC_URL, or ngrok in dev).
- CRUD: `/menu-items`, `/services`, `/faqs`. Create schemas add defaults; update schemas are `.partial().strict()` of a default-free base (zod applies defaults inside partial).
- `/conversations` (list: needs-attention first, `filter=all|attention|human`, `before`), `GET /:id` (messages + orders + bookings), `GET /:id/messages?after=` (polling), `PATCH /:id { mode, needsAttention }`, `POST /:id/messages { text }` (staff reply via `channels/outbound.ts`, sets mode HUMAN). WhatsApp items carry `replyWindowEndsAt/canReply` (24h rule).
- `/orders` and `/bookings`: list/get/`PATCH { status }` with allowed transitions only (409 otherwise). `?status=` takes one status or a comma list (`NEW,CONFIRMED,READY`).
- POST/PATCH/PUT must be JSON (415 otherwise) — CSRF guard together with SameSite cookies. CORS allows `DASHBOARD_ORIGIN` with credentials.

## Dashboard (`/dashboard`)
- Vite 8 + React 19 + TypeScript + Tailwind 4 (`@tailwindcss/vite`, theme tokens in `src/index.css`), react-router 8, TanStack Query 5, lucide-react icons.
- Dev: Vite proxies `/api` to the server (`VITE_API_PROXY`, default http://localhost:8080), so the session cookie is same-origin; `fetch` wrapper in `src/api/client.ts` throws `ApiError(status, message)`.
- `src/api/hooks.ts`: one hook per endpoint; inbox list + open conversation poll every 5s (`POLL_MS`). Types in `src/api/types.ts` mirror the server (money as strings).
- Pages: `/login`, `/register`, `/inbox/:conversationId?` (list with filters, chat, take over / give back, mark handled, staff reply, customer panel with orders/bookings), `/orders?tab=` (status tabs, cards with next-step actions, cancel, link to chat), `/bookings?week=YYYY-MM-DD` (Mon–Sun agenda, confirm / arrived / no-show / cancel), `/knowledge/:tab?` (business info + hours, menu, services, FAQs). Shared primitives in `src/components/ui.tsx`; status labels/colors in `src/lib/status.ts`.
- Booking and order times are formatted in the business's timezone (`formatInZone`, `dateKeyInZone` in `src/lib/format.ts`), never the browser's.
- Sidebar badges: conversations needing attention, NEW orders (both polled).
- Forms send only editable fields — the API's `.strict()` schemas reject extras like `createdAt`.

## Commands (run in /server unless noted)
- `docker compose up -d` (repo root) — start Postgres
- `npm run dev` — API on http://localhost:8080 (`GET /health`). Not 4000: Windows reserves 3926–4025 on this machine
- `npm run db:migrate` — create/apply migrations and regenerate the Prisma client (Prisma 7's `migrate dev` doesn't always regenerate — a stale client gives "Unknown argument" validation errors); `npm run db:seed` — reseed demo restaurant (idempotent); `npm run db:studio`
- `npm run chat` — chat with the demo restaurant in the terminal as a customer (`-- --name Sara --user sara --verbose`; `/reset`, `/status`, `/quit`). Needs the API key for `AI_PROVIDER` in `.env` (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`)
- `npm run telegram:webhook -- set [--token <BotFather token>] [--url https://…]` — store the bot token (encrypted) + a fresh secret and call setWebhook. URL is auto-detected from the running ngrok agent (`ngrok http 8080`); token is only needed the first time. Also `info` (webhook status/last error) and `delete`
- `npm test` (needs Postgres running; uses a separate `<db>_test` database, created and migrated automatically), `npm run typecheck`, `npm run build`
- Dashboard (in /dashboard): `npm run dev` → http://localhost:5173 (needs the server on 8080), `npm run build`, `npm run typecheck`
- Demo login: `demo@supportbot.test` / `demo1234` (business id `demo-selam-kitchen`)

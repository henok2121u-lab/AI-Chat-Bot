// Connects a business's Telegram bot to this server via webhook.
//
//   npm run telegram:webhook -- set --token 123456:ABC...        # URL auto-detected from ngrok
//   npm run telegram:webhook -- set --url https://xxxx.ngrok-free.app
//   npm run telegram:webhook -- info
//   npm run telegram:webhook -- delete
//
// Options: --business <id> (default demo-selam-kitchen). The token can also come
// from TELEGRAM_BOT_TOKEN in .env; after the first `set` it's stored (encrypted)
// in the database, so later runs (e.g. a new ngrok URL) don't need it.

import { parseArgs } from "node:util";
import { Api } from "grammy";
import { connectTelegramBot, disconnectTelegramBot, telegramWebhookUrl } from "../channels/telegram.js";
import { decryptSecret } from "../lib/crypto.js";
import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { detectNgrokUrl } from "../lib/ngrok.js";

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    business: { type: "string", default: "demo-selam-kitchen" },
    token: { type: "string" },
    url: { type: "string" },
  },
});
const command = positionals[0] ?? "info";

async function storedToken(businessId: string): Promise<string | undefined> {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { telegramBotToken: true } });
  return business?.telegramBotToken ? decryptSecret(business.telegramBotToken) : undefined;
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  const business = await db.business.findUnique({ where: { id: args.business }, select: { id: true, name: true } });
  if (!business) fail(`Business "${args.business}" not found. Run \`npm run db:seed\` first.`);

  if (command === "set") {
    const token = args.token ?? env.TELEGRAM_BOT_TOKEN ?? (await storedToken(business.id));
    if (!token) fail("No bot token. Create a bot with @BotFather, then pass --token <token> (or set TELEGRAM_BOT_TOKEN in .env).");

    const fromNgrok = args.url ? undefined : await detectNgrokUrl();
    const publicUrl = args.url ?? fromNgrok ?? env.PUBLIC_URL;
    if (!publicUrl) fail("No public URL. Start ngrok (`ngrok http ${env.PORT}`) or pass --url https://<your-ngrok-url>.");
    if (!publicUrl.startsWith("https://")) fail(`Telegram requires an https URL, got ${publicUrl}`);

    const { bot, webhookUrl } = await connectTelegramBot(db, { businessId: business.id, token, publicUrl });
    console.log(`\n✔ Connected @${bot.username} (${bot.name}) to ${business.name}`);
    console.log(`  Webhook: ${webhookUrl}${fromNgrok ? "  (URL detected from ngrok)" : ""}`);
    console.log(`  Chat with it: https://t.me/${bot.username}\n`);
    console.log("  Keep `npm run dev` and ngrok running. If the ngrok URL changes, run this again.\n");
    return;
  }

  if (command === "info") {
    const token = await storedToken(business.id);
    if (!token) fail(`${business.name} has no Telegram bot connected. Run: npm run telegram:webhook -- set --token <token>`);
    const api = new Api(token);
    const [me, info] = await Promise.all([api.getMe(), api.getWebhookInfo()]);
    console.log(`\nBot:              @${me.username} (${me.first_name})`);
    console.log(`Webhook URL:      ${info.url || "(none)"}`);
    console.log(`Pending updates:  ${info.pending_update_count}`);
    if (info.last_error_message) {
      const when = info.last_error_date ? new Date(info.last_error_date * 1000).toLocaleString() : "unknown time";
      console.log(`Last error:       ${info.last_error_message} (${when})`);
    }
    const ngrok = await detectNgrokUrl();
    if (ngrok && info.url !== telegramWebhookUrl(ngrok, business.id)) {
      console.log(`\n⚠ ngrok is now at ${ngrok} — run \`npm run telegram:webhook -- set\` to update the webhook.`);
    }
    console.log();
    return;
  }

  if (command === "delete") {
    await disconnectTelegramBot(db, business.id);
    console.log(`\n✔ Webhook removed and bot token cleared for ${business.name}.\n`);
    return;
  }

  fail(`Unknown command "${command}". Use: set | info | delete`);
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("401")) fail(`Telegram rejected the bot token (401 Unauthorized). Copy it again from @BotFather.`);
    fail(message);
  })
  .finally(() => db.$disconnect());

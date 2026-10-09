// Chat with the bot in the terminal as a customer, without any messaging channel.
//
//   npm run chat                         # demo restaurant, customer "Abebe"
//   npm run chat -- --name Sara --user sara --verbose
//
// Commands: /reset (start a fresh conversation), /status, /quit

import readline from "node:readline";
import { parseArgs } from "node:util";
import { createConversationEngine, type ReplySender } from "../engine/conversation.js";
import { createAiClient } from "../lib/ai.js";
import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const { values: args } = parseArgs({
  options: {
    business: { type: "string", default: "demo-selam-kitchen" },
    name: { type: "string", default: "Abebe" },
    user: { type: "string", default: "cli-abebe" },
    verbose: { type: "boolean", default: false },
  },
});

const color = { bot: "\x1b[36m", dim: "\x1b[2m", warn: "\x1b[33m", reset: "\x1b[0m" };

if (!args.verbose) logger.level = "warn";

const business = await db.business.findUnique({ where: { id: args.business }, select: { id: true, name: true } });
if (!business) {
  console.error(`Business "${args.business}" not found. Run \`npm run db:seed\` first.`);
  process.exit(1);
}

const ai = createAiClient();
const engine = createConversationEngine({
  db,
  ai: ai.client,
  logger,
  model: ai.model,
  effort: env.AI_EFFORT,
});

const cliSender: ReplySender = {
  async send(_to, text) {
    console.log(`\n${color.bot}${business.name}:${color.reset} ${text}\n`);
  },
};

async function findConversation() {
  return db.conversation.findFirst({
    where: { businessId: business!.id, channel: "CLI", customer: { externalId: args.user } },
    orderBy: { lastMessageAt: "desc" },
  });
}

console.log(
  `${color.dim}Chatting with ${business.name} as "${args.name}" (${ai.provider} ${ai.model}, effort ${env.AI_EFFORT}).\n` +
    `Commands: /reset  /status  /quit${color.reset}\n`,
);

if (ai.provider === "anthropic" && !env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log(
    `${color.warn}No ANTHROPIC_API_KEY in .env — replies will fail unless you're signed in with \`ant auth login\`.${color.reset}\n`,
  );
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "You: " });
let inputClosed = false;
rl.on("close", () => (inputClosed = true));
rl.prompt();

// Async iteration queues lines typed (or piped) while a reply is in flight.
for await (const line of rl) {
  const text = line.trim();
  if (text === "/quit" || text === "/exit") break;
  if (text) await handle(text);
  if (!inputClosed) rl.prompt();
}

rl.close();
await db.$disconnect();

async function handle(text: string) {
  if (text === "/reset") {
    await db.conversation.deleteMany({
      where: { businessId: business!.id, channel: "CLI", customer: { externalId: args.user } },
    });
    console.log(`${color.dim}Conversation cleared.${color.reset}\n`);
    return;
  }

  if (text === "/status") {
    const convo = await findConversation();
    const status = convo
      ? `mode=${convo.mode} needsAttention=${convo.needsAttention}` +
        (convo.handoffReason ? ` reason="${convo.handoffReason}"` : "")
      : "no conversation yet";
    console.log(`${color.dim}${status}${color.reset}\n`);
    return;
  }

  const result = await engine.handleIncomingMessage(
    { businessId: business!.id, channel: "cli", externalUserId: args.user, customerName: args.name, text },
    cliSender,
  );

  if (result.status === "human_mode") {
    console.log(`${color.warn}[Handed to staff — the bot is paused for this chat. Use /reset to start over.]${color.reset}\n`);
  } else if (result.status === "bot_disabled") {
    console.log(`${color.warn}[The bot is turned off for this business.]${color.reset}\n`);
  }
}

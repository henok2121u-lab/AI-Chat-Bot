import { createApp } from "./app.js";
import { createConversationEngine } from "./engine/conversation.js";
import { createAiClient } from "./lib/ai.js";
import { db } from "./lib/db.js";
import { env } from "./lib/env.js";
import { KeyedQueue } from "./lib/keyed-queue.js";
import { logger } from "./lib/logger.js";

const ai = createAiClient();
const engine = createConversationEngine({ db, ai: ai.client, logger, model: ai.model, effort: env.AI_EFFORT });
// Messages are processed after the webhook is acknowledged, one at a time per chat.
const queue = new KeyedQueue((err, key) => logger.error({ err, key }, "Message processing failed"));

const app = createApp({ telegram: { db, engine, logger, queue } });

const server = app.listen(env.PORT, (err) => {
  // Express 5 reports listen failures (port in use, EACCES on a Windows-reserved port) here.
  if (err) {
    logger.fatal({ err }, `Could not listen on port ${env.PORT}`);
    process.exit(1);
  }
  logger.info(`SupportBot server listening on http://localhost:${env.PORT} (AI: ${ai.provider} ${ai.model})`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close();
  await queue.drain(); // let in-flight replies finish
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

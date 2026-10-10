import express, { type ErrorRequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { type TelegramWebhookDeps, telegramWebhookRouter } from "./channels/telegram.js";
import { logger } from "./lib/logger.js";
import { healthRouter } from "./routes/health.js";

export interface AppDeps {
  telegram: TelegramWebhookDeps;
}

export function createApp(deps: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use("/webhooks/telegram", telegramWebhookRouter(deps.telegram));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues });
      return;
    }
    req.log.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}

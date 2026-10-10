import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { ZodError, z } from "zod";
import { type TelegramWebhookDeps, telegramWebhookRouter } from "./channels/telegram.js";
import { Prisma } from "./generated/prisma/client.js";
import { env } from "./lib/env.js";
import { HttpError } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { type ApiDeps, apiRouter } from "./routes/api.js";
import { healthRouter } from "./routes/health.js";

export interface AppDeps {
  telegram: TelegramWebhookDeps;
  api: ApiDeps;
}

export function createApp(deps: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use("/webhooks/telegram", telegramWebhookRouter(deps.telegram));
  app.use("/api", cors({ origin: env.DASHBOARD_ORIGIN, credentials: true }), cookieParser(), apiRouter(deps.api));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: z.prettifyError(err), issues: err.issues });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Record not found — also what a businessId-scoped update/delete hits for another tenant's id.
      if (err.code === "P2025") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (err.code === "P2002") {
        res.status(409).json({ error: "Already exists" });
        return;
      }
    }
    // Malformed JSON body from express.json().
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Malformed JSON" });
      return;
    }
    req.log.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}

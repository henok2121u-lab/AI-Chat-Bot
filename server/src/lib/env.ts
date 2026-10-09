import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// .env lives at the repo root (shared with docker-compose). Real env vars win.
loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url(),

  PUBLIC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  DASHBOARD_ORIGIN: z.url().default("http://localhost:5173"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes as 64 hex characters"),

  AI_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  /** low | medium | high | xhigh | max — mapped to each provider's thinking setting. */
  AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),

  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),

  // Optional: without it the SDK falls back to an `ant auth login` profile.
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  // Needed only when the API key isn't scoped to a workspace.
  ANTHROPIC_WORKSPACE_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),

  WHATSAPP_VERIFY_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_APP_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:\n" + z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });

// Tests use a separate database next to the dev one: <db>_test.
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL (or TEST_DATABASE_URL) must be set to run tests");
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/^\//, "")}_test`;
  return url.toString();
}

// globalSetup runs outside the workers and doesn't see `test.env`, so share it this way.
const databaseUrl = testDatabaseUrl();
process.env.TEST_DATABASE_URL = databaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: databaseUrl,
    },
  },
});

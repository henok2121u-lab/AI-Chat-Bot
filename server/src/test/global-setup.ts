import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Creates the test database if needed and applies all migrations to it.
export default async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL!; // set in vitest.config.ts
  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error(`Unsafe test database name: ${dbName}`);

  url.pathname = "/postgres";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    const rows = await admin.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS "exists"`;
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

const key = randomBytes(32).toString("hex");

describe("secret encryption", () => {
  it("round-trips a secret", () => {
    const token = "123456:ABC-telegram-bot-token";
    const encrypted = encryptSecret(token, key);
    expect(encrypted).not.toContain(token);
    expect(decryptSecret(encrypted, key)).toBe(token);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptSecret("secret", key).split(":");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0]! ^= 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("secret", key);
    expect(() => decryptSecret(encrypted, randomBytes(32).toString("hex"))).toThrow();
  });
});

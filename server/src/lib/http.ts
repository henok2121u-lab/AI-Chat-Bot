import { z } from "zod";

/** Throw from a route to send `{ error: message }` with the given status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const idParams = z.object({ id: z.string().min(1).max(64) });

/** Money as a number or numeric string, e.g. 950 or "950.50"; passed to Prisma as a string (Decimal). */
export const money = z
  .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected an amount like 950 or 950.50")])
  .transform((v) => String(v))
  .refine((v) => Number(v) <= 99_999_999, "Amount too large");

/** Optional free text: "" becomes null so fields can be cleared. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

// ngrok's local API normally listens on 4040, but falls back to other ports when
// that one is taken or reserved (on Windows it often ends up on 4041+ or 404xx).
const NGROK_API_CANDIDATES = [
  ...(process.env.NGROK_API_URL ? [process.env.NGROK_API_URL] : []),
  ...[4040, 4041, 4042, 4043, 4044, 4045].map((p) => `http://127.0.0.1:${p}`),
  ...Array.from({ length: 11 }, (_, i) => `http://127.0.0.1:${40400 + i}`),
];

/** Reads the public https URL of a running ngrok agent from its local API (dev only). */
export async function detectNgrokUrl(): Promise<string | undefined> {
  const lookups = NGROK_API_CANDIDATES.map(async (base) => {
    const res = await fetch(`${base}/api/tunnels`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { tunnels?: { public_url?: string }[] };
    const url = body.tunnels?.map((t) => t.public_url).find((u) => u?.startsWith("https://"));
    if (!url) throw new Error("no https tunnel");
    return url;
  });
  return Promise.any(lookups).catch(() => undefined);
}

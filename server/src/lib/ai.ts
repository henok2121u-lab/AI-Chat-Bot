import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { createGeminiClient } from "./gemini.js";

/**
 * The slice of the Anthropic client the engine depends on. Tests pass a fake
 * implementation; production wraps the real SDK client.
 */
export interface AiClient {
  createMessage(
    params: Anthropic.Beta.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Beta.BetaMessage>;
}

export function createAnthropicClient(): AiClient {
  // dotenv leaves an empty ANTHROPIC_API_KEY="" in process.env, which would
  // shadow an `ant auth login` profile. Let the SDK resolve credentials itself.
  if (process.env.ANTHROPIC_API_KEY === "") delete process.env.ANTHROPIC_API_KEY;

  const client = new Anthropic({
    ...(env.ANTHROPIC_API_KEY && { apiKey: env.ANTHROPIC_API_KEY }),
    // Keys that aren't scoped to a workspace must name one on every request.
    ...(env.ANTHROPIC_WORKSPACE_ID && { defaultHeaders: { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } }),
  });
  return {
    createMessage: (params) => client.beta.messages.create(params),
  };
}

/** Builds the client for the configured AI_PROVIDER, plus the model name to send. */
export function createAiClient(): { client: AiClient; model: string; provider: string } {
  if (env.AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("AI_PROVIDER=gemini but GEMINI_API_KEY is not set in .env");
    return { client: createGeminiClient(env.GEMINI_API_KEY), model: env.GEMINI_MODEL, provider: "gemini" };
  }
  return { client: createAnthropicClient(), model: env.ANTHROPIC_MODEL, provider: "anthropic" };
}

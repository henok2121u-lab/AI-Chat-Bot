import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { type Content, FinishReason, GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import type { AiClient } from "./ai.js";

// Adapts Google Gemini to the AiClient interface. The engine speaks the
// Anthropic Messages shape (system / tools / tool_use / tool_result); this file
// translates requests into Gemini `generateContent` calls and responses back.

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

const REFUSAL_REASONS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

const THINKING_LEVEL: Record<string, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

export function createGeminiClient(apiKey: string): AiClient {
  const genai = new GoogleGenAI({
    apiKey,
    // Retry 408/429/5xx (e.g. "model is experiencing high demand") with backoff,
    // capped so a chat customer isn't left waiting much longer than ~15s.
    httpOptions: { retryOptions: { attempts: 4, initialDelay: 1, maxDelay: 8 } },
  });
  // Gemini requires each function call's thought signature to be sent back with it.
  const thoughtSignatures = new Map<string, string>();

  return {
    async createMessage(params) {
      const response = await genai.models.generateContent({
        model: params.model,
        contents: toContents(params.messages, thoughtSignatures),
        config: {
          systemInstruction: systemText(params.system),
          maxOutputTokens: params.max_tokens,
          tools: params.tools?.length ? [{ functionDeclarations: params.tools.map(toFunctionDeclaration) }] : undefined,
          thinkingConfig: params.output_config?.effort
            ? { thinkingLevel: THINKING_LEVEL[params.output_config.effort] }
            : undefined,
        },
      });

      const candidate = response.candidates?.[0];
      const content: Anthropic.Beta.BetaContentBlock[] = [];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.thought) continue;
        if (part.functionCall) {
          const id = part.functionCall.id ?? `call_${randomUUID()}`;
          if (part.thoughtSignature) thoughtSignatures.set(id, part.thoughtSignature);
          content.push({
            type: "tool_use",
            id,
            name: part.functionCall.name ?? "",
            input: part.functionCall.args ?? {},
          } as Anthropic.Beta.BetaToolUseBlock);
        } else if (part.text) {
          // One reply can arrive split across several text parts; keep it as one block.
          const last = content.at(-1);
          if (last?.type === "text") last.text += part.text;
          else content.push({ type: "text", text: part.text, citations: null });
        }
      }

      const finish = candidate?.finishReason;
      const stop_reason: Anthropic.Beta.BetaStopReason = content.some((b) => b.type === "tool_use")
        ? "tool_use"
        : response.promptFeedback?.blockReason || REFUSAL_REASONS.has(finish)
          ? "refusal"
          : finish === FinishReason.MAX_TOKENS
            ? "max_tokens"
            : "end_turn";

      return {
        id: response.responseId ?? `gemini_${randomUUID()}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content,
        stop_reason,
        stop_sequence: null,
        stop_details: null,
        usage: {
          input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

function systemText(system: Params["system"]): string | undefined {
  if (!system) return undefined;
  return typeof system === "string" ? system : system.map((b) => b.text).join("\n\n");
}

function toFunctionDeclaration(tool: NonNullable<Params["tools"]>[number]) {
  const t = tool as Anthropic.Beta.BetaTool;
  return { name: t.name, description: t.description, parametersJsonSchema: t.input_schema };
}

function toContents(messages: Params["messages"], signatures: Map<string, string>): Content[] {
  // tool_result blocks only carry the id; Gemini also wants the function name.
  const toolNames = new Map<string, string>();
  const contents: Content[] = [];

  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const blocks =
      typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
    const parts: Part[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case "text":
          parts.push({ text: block.text });
          break;
        case "tool_use":
          toolNames.set(block.id, block.name);
          parts.push({
            functionCall: { id: block.id, name: block.name, args: block.input as Record<string, unknown> },
            ...(signatures.has(block.id) && { thoughtSignature: signatures.get(block.id) }),
          });
          break;
        case "tool_result":
          parts.push({
            functionResponse: {
              id: block.tool_use_id,
              name: toolNames.get(block.tool_use_id) ?? "unknown",
              response: parseToolResult(block.content),
            },
          });
          break;
        // thinking, fallback and other Anthropic-only blocks have no Gemini equivalent.
      }
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

function parseToolResult(content: Anthropic.Beta.BetaToolResultBlockParam["content"]): Record<string, unknown> {
  const text =
    typeof content === "string" ? content : (content ?? []).map((c) => ("text" in c ? c.text : "")).join("");
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };
  } catch {
    return { result: text };
  }
}

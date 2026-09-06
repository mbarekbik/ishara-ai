import { GoogleGenAI } from "@google/genai";
import { buildConversationInput } from "./context.js";
import { ConversationError, isRecord, validateProviderOutput, type ConversationRequest, type ConversationService } from "./contract.js";
import { ISHARA_CONVERSATION_INSTRUCTION_V1 } from "./systemInstruction.js";

export const CONVERSATION_MODEL = "gemini-3.8-flash";
export function conversationParameters(request: ConversationRequest) {
  return {
    model: CONVERSATION_MODEL, store: false, stream: false as const, background: false,
    system_instruction: ISHARA_CONVERSATION_INSTRUCTION_V1,
    input: buildConversationInput(request),
    generation_config: { thinking_level: "low" as const, max_output_tokens: 1_024 },
    response_format: {
      type: "text" as const, mime_type: "application/json",
      schema: {
        type: "object", additionalProperties: false, required: ["outcome", "text", "language"],
        properties: {
          outcome: { type: "string", enum: ["reply", "declined", "language_required"] },
          text: { type: "string" }, language: { type: "string", enum: ["en", "ar", "und"] },
        },
      },
    },
  };
}

export function normalizeProviderError(error: unknown): ConversationError {
  if (error instanceof ConversationError) return error;
  const status = isRecord(error) ? error.status : undefined;
  if (status === 429) return new ConversationError("AI_RATE_LIMITED", 429, true);
  if (typeof status === "number" && status >= 500) return new ConversationError("AI_UPSTREAM_UNAVAILABLE", 503, true);
  if (error instanceof Error) {
    // SDK 2.21's Interactions bridge wraps HTTPClientError subclasses in
    // APIConnectionError/APIConnectionTimeoutError. These classes are not
    // public exports, so match their exact names; never inspect provider text.
    if (["APIConnectionTimeoutError", "RequestTimeoutError", "TimeoutError"].includes(error.name))
      return new ConversationError("AI_TIMEOUT", 504, true);
    if (["APIConnectionError", "ConnectionError"].includes(error.name))
      return new ConversationError("AI_UPSTREAM_UNAVAILABLE", 503, true);
  }
  return new ConversationError("AI_UPSTREAM_ERROR", 502, true);
}

export function createGeminiConversationService(apiKey: string): ConversationService {
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  return async (request, signal) => {
    try {
      signal.throwIfAborted();
      const interaction = await client.interactions.create(conversationParameters(request), {
        signal, retries: { strategy: "none" }, timeout_ms: 20_000,
      });
      signal.throwIfAborted();
      if (interaction.status !== "completed" || interaction.errors?.length)
        throw new ConversationError("AI_INVALID_RESPONSE", 502, true);
      // Only the final model-output step is eligible. Thought/tool/user content
      // never enters the reply, even if it resembles the expected JSON.
      const output = interaction.steps?.slice().reverse().find((step) => step.type === "model_output");
      if (!output || output.type !== "model_output" || output.error || !output.content?.length ||
          output.content.some((content) => content.type !== "text"))
        throw new ConversationError("AI_INVALID_RESPONSE", 502, true);
      const text = output.content.map((content) => content.type === "text" ? content.text ?? "" : "").join("");
      // Bound parsing too, not only the final visible result.
      if (Buffer.byteLength(text, "utf8") > 8_192) throw new ConversationError("AI_INVALID_RESPONSE", 502, true);
      let result: unknown;
      try { result = JSON.parse(text); } catch { throw new ConversationError("AI_INVALID_RESPONSE", 502, true); }
      return validateProviderOutput(result, request.responseLanguage);
    } catch (error) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      throw normalizeProviderError(error);
    }
  };
}

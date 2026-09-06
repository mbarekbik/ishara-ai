import {
  AIError, AI_ERROR_CODES, AI_LIMITS, validateAIResult,
  type AIConfig, type AIErrorCode, type AIService,
} from "./service";
import { utf8Bytes } from "./context";

const REQUEST_DEADLINE_MS = 25_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function createGeminiConversationService(fetcher: typeof fetch = (...args) => fetch(...args)): AIService {
  async function request(path: string, signal: AbortSignal, body?: string): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_DEADLINE_MS);
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(timedOut ? new AIError("AI_TIMEOUT", true) : new DOMException("Cancelled", "AbortError"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    try {
      return await Promise.race([aborted, (async () => {
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const response = await fetcher(`/api/ai/${path}`, {
          method: body === undefined ? "GET" : "POST", body,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const raw = await response.text();
        if (utf8Bytes(raw) > AI_LIMITS.maxRequestBytes) throw new AIError("AI_INVALID_RESPONSE", true);
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw new AIError("AI_INVALID_RESPONSE", true); }
        if (!response.ok) {
          const error = record(data) && record(data.error) ? data.error : undefined;
          const code = error && AI_ERROR_CODES.includes(error.code as AIErrorCode) ? error.code as AIErrorCode : "AI_UPSTREAM_ERROR";
          const retryAfter = Number(response.headers.get("Retry-After"));
          throw new AIError(code, error?.retryable === true,
            Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined);
        }
        return data;
      })()]);
    } catch (error) {
      if (timedOut) throw new AIError("AI_TIMEOUT", true);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (error instanceof AIError) throw error;
      throw new AIError("AI_NETWORK_ERROR", true);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
    }
  }
  return {
    kind: "service",
    async getConfig(signal) {
      const data = await request("conversation-config", signal);
      if (!record(data) || typeof data.enabled !== "boolean" || !record(data.limits) ||
          !Array.isArray(data.responseLanguages) || data.responseLanguages.join(",") !== "auto,en,ar") {
        throw new AIError("AI_UNAVAILABLE", true);
      }
      const limits = data.limits;
      if (!Object.entries(AI_LIMITS).every(([key, limit]) => limits[key] === limit)) throw new AIError("AI_UNAVAILABLE", true);
      return { enabled: data.enabled, responseLanguages: ["auto", "en", "ar"], limits: AI_LIMITS } satisfies AIConfig;
    },
    async reply({ messages, responseLanguage, signal }) {
      // Reconstruct the transport fields; operation/session/device data never crosses this boundary.
      const body = JSON.stringify({ responseLanguage, messages: messages.map(({ speaker, text, language, source }) => ({ speaker, text, language, source })) });
      if (utf8Bytes(body) > AI_LIMITS.maxRequestBytes) throw new AIError("AI_MESSAGE_TOO_LARGE");
      const data = await request("respond", signal, body);
      if (!record(data) || typeof data.reply !== "string" || typeof data.language !== "string") throw new AIError("AI_INVALID_RESPONSE", true);
      const result = { text: data.reply, language: data.language, source: "service" as const };
      validateAIResult(result, "service", responseLanguage);
      return result;
    },
  };
}

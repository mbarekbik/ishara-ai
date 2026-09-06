import type { RecognitionResult } from "../communication/interaction";
export type ResponseLanguage = "auto" | "en" | "ar";
export interface AIContextMessage {
  speaker: "participant-1" | "participant-2" | "assistant";
  text: string;
  language: string;
  source: "mock" | "user" | "service";
}
export const AI_LIMITS = {
  maxMessages: 12,
  maxMessageBytes: 8 * 1024,
  maxTextBytes: 16 * 1024,
  maxRequestBytes: 64 * 1024,
  maxReplyCodePoints: 600,
} as const;
export interface AIConfig {
  enabled: boolean;
  responseLanguages: ResponseLanguage[];
  limits: typeof AI_LIMITS;
}
export const AI_ERROR_CODES = [
  "AI_NO_HUMAN_MESSAGE", "AI_MESSAGE_TOO_LARGE", "AI_INVALID_REQUEST",
  "AI_LANGUAGE_REQUIRED", "AI_FORBIDDEN", "AI_UNAVAILABLE", "AI_RATE_LIMITED",
  "AI_UPSTREAM_UNAVAILABLE", "AI_UPSTREAM_ERROR", "AI_TIMEOUT", "AI_INVALID_RESPONSE",
  "AI_DECLINED", "AI_NETWORK_ERROR", "AI_CONVERSATION_CHANGED",
] as const;
export type AIErrorCode = typeof AI_ERROR_CODES[number];
export class AIError extends Error {
  constructor(public readonly code: AIErrorCode, public readonly retryable = false,
    public readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "AIError";
  }
}
export function normalizeAIError(error: unknown): AIError {
  return error instanceof AIError ? error : new AIError("AI_NETWORK_ERROR", true);
}
export interface AIRequest {
  messages: readonly AIContextMessage[];
  responseLanguage: ResponseLanguage;
}
export interface AIService {
  kind: "mock" | "service";
  getConfig?: (signal: AbortSignal) => Promise<AIConfig>;
  reply: (input: AIRequest & {
    signal: AbortSignal;
  }) => Promise<RecognitionResult>;
}

/** Validate even injected adapters before they can enter the session store. */
export function validateAIResult(result: RecognitionResult, source: AIService["kind"], language: ResponseLanguage): void {
  if (typeof result?.text !== "string" || !result.text.trim() ||
      Array.from(result.text).length > AI_LIMITS.maxReplyCodePoints ||
      (result.language !== "en" && result.language !== "ar") ||
      (language !== "auto" && result.language !== language) || result.source !== source) {
    throw new AIError("AI_INVALID_RESPONSE", true);
  }
}

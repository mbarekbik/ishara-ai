export const CONVERSATION_LIMITS = Object.freeze({
  maxMessages: 12, maxMessageBytes: 8_192, maxTextBytes: 16_384,
  maxRequestBytes: 65_536, maxReplyCodePoints: 600,
});
export type ResponseLanguage = "auto" | "en" | "ar";
export interface ConversationMessage {
  speaker: "participant-1" | "participant-2" | "assistant";
  text: string;
  language: string;
  source: "mock" | "user" | "service";
}
export interface ConversationRequest {
  responseLanguage: ResponseLanguage;
  messages: ConversationMessage[];
}
export interface ConversationReply { reply: string; language: "en" | "ar" }
export type ConversationService = (request: ConversationRequest, signal: AbortSignal) => Promise<ConversationReply>;
export type ConversationErrorCode =
  | "AI_NO_HUMAN_MESSAGE" | "AI_MESSAGE_TOO_LARGE" | "AI_INVALID_REQUEST"
  | "AI_LANGUAGE_REQUIRED" | "AI_FORBIDDEN" | "AI_UNAVAILABLE" | "AI_RATE_LIMITED"
  | "AI_UPSTREAM_UNAVAILABLE" | "AI_UPSTREAM_ERROR" | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE" | "AI_DECLINED";

export class ConversationError extends Error {
  constructor(readonly code: ConversationErrorCode, readonly status: number, readonly retryable = false) {
    super(code);
    this.name = "ConversationError";
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function isLanguageTag(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 35 || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value)) return false;
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}
export function validateConversationRequest(value: unknown): ConversationRequest {
  const invalid = () => new ConversationError("AI_INVALID_REQUEST", 400);
  if (!isRecord(value) || !exactKeys(value, ["responseLanguage", "messages"]) ||
      !["auto", "en", "ar"].includes(String(value.responseLanguage)) || typeof value.responseLanguage !== "string" ||
      !Array.isArray(value.messages) || value.messages.length > CONVERSATION_LIMITS.maxMessages) throw invalid();
  if (!value.messages.length) throw new ConversationError("AI_NO_HUMAN_MESSAGE", 400);
  let bytes = 0;
  const messages = value.messages.map((message: unknown): ConversationMessage => {
    if (!isRecord(message) || !exactKeys(message, ["speaker", "text", "language", "source"]) ||
        typeof message.speaker !== "string" || typeof message.source !== "string" ||
        !["participant-1", "participant-2", "assistant"].includes(String(message.speaker)) ||
        !["mock", "user", "service"].includes(String(message.source)) ||
        typeof message.text !== "string" || !message.text.trim() || !isLanguageTag(message.language) ||
        (message.speaker === "assistant" && message.source !== "service")) throw invalid();
    const size = Buffer.byteLength(message.text, "utf8");
    if (size > CONVERSATION_LIMITS.maxMessageBytes) throw new ConversationError("AI_MESSAGE_TOO_LARGE", 400);
    bytes += size;
    return { speaker: message.speaker as ConversationMessage["speaker"], text: message.text,
      language: message.language, source: message.source as ConversationMessage["source"] };
  });
  if (bytes > CONVERSATION_LIMITS.maxTextBytes) throw new ConversationError("AI_MESSAGE_TOO_LARGE", 400);
  if (messages.at(-1)!.speaker === "assistant") throw new ConversationError("AI_NO_HUMAN_MESSAGE", 400);
  if (messages[0].speaker === "assistant") throw invalid();
  return { responseLanguage: value.responseLanguage as ResponseLanguage, messages };
}
export function validateProviderOutput(value: unknown, requested: ResponseLanguage): ConversationReply {
  const invalid = () => new ConversationError("AI_INVALID_RESPONSE", 502, true);
  if (!isRecord(value) || !exactKeys(value, ["outcome", "text", "language"]) ||
      typeof value.outcome !== "string" || typeof value.language !== "string" ||
      !["reply", "declined", "language_required"].includes(String(value.outcome)) ||
      !["en", "ar", "und"].includes(String(value.language)) || typeof value.text !== "string" ||
      Array.from(value.text).length > CONVERSATION_LIMITS.maxReplyCodePoints) throw invalid();
  if (value.outcome === "declined") throw new ConversationError("AI_DECLINED", 422);
  if (value.outcome === "language_required") throw new ConversationError("AI_LANGUAGE_REQUIRED", 422);
  if (!value.text.trim() || value.language === "und" || (requested !== "auto" && value.language !== requested)) throw invalid();
  return { reply: value.text.trim(), language: value.language as "en" | "ar" };
}

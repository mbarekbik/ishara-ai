import type { Message } from "../communication/model";
import { AIError, AI_LIMITS, type AIContextMessage } from "./service";

export interface AIContextSelection {
  messages: AIContextMessage[];
  omittedCount: number;
}
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** Drop entire older messages. Never summarize, rewrite or cut their text. */
export function selectAIContext(history: readonly Message[]): AIContextSelection {
  if (!history.length || history.at(-1)?.sender.kind !== "human") {
    throw new AIError("AI_NO_HUMAN_MESSAGE");
  }
  const selected: AIContextMessage[] = [];
  let totalBytes = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message.sender.kind === "assistant" && message.source === "mock") continue;
    const size = utf8Bytes(message.text);
    if (size > AI_LIMITS.maxMessageBytes) {
      if (!selected.length) throw new AIError("AI_MESSAGE_TOO_LARGE");
      break;
    }
    if (selected.length === AI_LIMITS.maxMessages || totalBytes + size > AI_LIMITS.maxTextBytes) break;
    const speaker = message.sender.kind === "assistant" ? "assistant" : message.sender.id;
    if ((speaker !== "participant-1" && speaker !== "participant-2" && speaker !== "assistant") ||
        (speaker === "assistant" && message.source !== "service") || !message.text.trim() ||
        !validLanguageTag(message.language)) {
      throw new AIError("AI_INVALID_REQUEST");
    }
    selected.push({ speaker, text: message.text, language: message.language, source: message.source });
    totalBytes += size;
  }
  selected.reverse();
  while (selected[0]?.speaker === "assistant") selected.shift();
  return { messages: selected, omittedCount: history.length - selected.length };
}

function validLanguageTag(value: string): boolean {
  if (!value || value.length > 35) return false;
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}

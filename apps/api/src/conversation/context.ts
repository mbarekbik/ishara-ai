import type { ConversationRequest } from "./contract.js";

export function buildConversationInput(request: ConversationRequest): string {
  // JSON encoding preserves attribution and text boundaries. This entire envelope is
  // untrusted conversation data; it never becomes a system instruction or chat role.
  return JSON.stringify({
    kind: "ishara_conversation_data_v1", responseLanguage: request.responseLanguage,
    messages: request.messages.map(({ speaker, text, language, source }) => ({ speaker, text, language, source })),
  });
}

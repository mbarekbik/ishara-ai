export interface LiveConfig {
  enabled: boolean;
  apiKey?: string;
  allowedOrigins: string[];
}
export interface ConversationConfig {
  enabled: boolean;
  apiKey?: string;
  allowedOrigins: string[];
}

function readOrigins(value: string | undefined, name: string) {
  const origins = (value ?? "http://127.0.0.1:5173,http://localhost:5173").split(",").map((origin) => origin.trim());
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error(`${name} must contain exact HTTP(S) origins`); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      throw new Error(`${name} must contain exact HTTP(S) origins`);
  }
  return origins;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
  const flag = env.LIVE_TRANSCRIPTION_ENABLED ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new Error("LIVE_TRANSCRIPTION_ENABLED must be true or false");
  const conversationFlag = env.AI_CONVERSATION_ENABLED ?? "false";
  if (conversationFlag !== "true" && conversationFlag !== "false")
    throw new Error("AI_CONVERSATION_ENABLED must be true or false");
  const apiKey = env.GEMINI_API_KEY?.trim() || undefined;
  return {
    port,
    live: { enabled: flag === "true", apiKey, allowedOrigins: readOrigins(env.LIVE_ALLOWED_ORIGINS, "LIVE_ALLOWED_ORIGINS") } satisfies LiveConfig,
    conversation: { enabled: conversationFlag === "true", apiKey, allowedOrigins: readOrigins(env.AI_ALLOWED_ORIGINS, "AI_ALLOWED_ORIGINS") } satisfies ConversationConfig,
  };
}

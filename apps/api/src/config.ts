export interface LiveConfig {
  enabled: boolean;
  apiKey?: string;
  allowedOrigins: string[];
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
  const flag = env.LIVE_TRANSCRIPTION_ENABLED ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new Error("LIVE_TRANSCRIPTION_ENABLED must be true or false");
  const allowedOrigins = (env.LIVE_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",").map((value) => value.trim());
  for (const origin of allowedOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("LIVE_ALLOWED_ORIGINS must contain exact HTTP(S) origins"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error("LIVE_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
  }
  return { port, live: { enabled: flag === "true", apiKey: env.GEMINI_API_KEY?.trim() || undefined, allowedOrigins } satisfies LiveConfig };
}

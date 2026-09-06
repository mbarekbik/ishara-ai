import type { ProtocolCredential } from "./geminiLiveClient";
import type { SpeechLanguage } from "./service";
import { voiceError } from "./errors";
async function request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  try {
    const response = await fetch(path, {
      signal: controller.signal, cache: "no-store", credentials: "same-origin",
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const code = data && typeof data === "object" && "error" in data && data.error && typeof data.error === "object" && "code" in data.error ? data.error.code : undefined;
      throw new Error(voiceError(code, "LIVE_UNAVAILABLE"));
    }
    return data;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error(timedOut ? "LIVE_TIMEOUT" : voiceError(error, "LIVE_UNAVAILABLE"));
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export async function getLiveConfig(signal: AbortSignal): Promise<{ enabled: boolean }> {
  const value = await request("/api/ai/live-config", signal);
  if (!value || typeof value !== "object" || !("enabled" in value) || typeof value.enabled !== "boolean") throw new Error("LIVE_UNAVAILABLE");
  return { enabled: value.enabled };
}
export async function getLiveToken(speechLanguage: SpeechLanguage, signal: AbortSignal): Promise<ProtocolCredential> {
  const value = await request("/api/ai/live-token", signal, { speechLanguage });
  if (!value || typeof value !== "object") throw new Error("LIVE_CREDENTIAL_INVALID");
  const credential = value as Partial<ProtocolCredential>;
  if (typeof credential.token !== "string" || !credential.token.startsWith("auth_tokens/") || credential.apiVersion !== "v1beta" || credential.model !== "gemini-3.5-transcribe-live" || typeof credential.newSessionExpiresAt !== "string" || typeof credential.expiresAt !== "string") throw new Error("LIVE_CREDENTIAL_INVALID");
  return credential as ProtocolCredential;
}

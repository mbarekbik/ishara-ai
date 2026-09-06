export const voiceErrors = [
  "MIC_DENIED", "MIC_MISSING", "MIC_BUSY", "MIC_UNSUPPORTED", "MIC_ENDED", "MIC_CAPTURE_ERROR",
  "LIVE_UNAVAILABLE", "LIVE_FORBIDDEN", "LIVE_RATE_LIMITED", "LIVE_AUTH_ERROR", "LIVE_EXPIRED",
  "LIVE_CREDENTIAL_INVALID", "LIVE_UPSTREAM_ERROR", "LIVE_TIMEOUT", "LIVE_SETUP_TIMEOUT",
  "LIVE_CONNECTION_ERROR", "LIVE_CONNECTION_CLOSED", "LIVE_SESSION_INTERRUPTED", "LIVE_INVALID_EVENT",
  "LIVE_CONNECTION_TOO_SLOW", "LIVE_NOT_CONNECTED", "LIVE_NOT_LISTENING", "LIVE_INVALID_AUDIO",
  "LIVE_FINALIZATION_TIMEOUT", "LIVE_INCOMPLETE_TRANSCRIPT", "serviceError", "emptyResult",
] as const;
export type VoiceErrorCode = typeof voiceErrors[number];
export function voiceError(error: unknown, fallback: VoiceErrorCode = "LIVE_CONNECTION_ERROR"): VoiceErrorCode {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return voiceErrors.includes(code as VoiceErrorCode) ? code as VoiceErrorCode : fallback;
}

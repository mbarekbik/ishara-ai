import { GoogleGenAI, Modality, AudioTranscriptionConfigMode, type CreateAuthTokenParameters } from "@google/genai";

export const LIVE_MODEL = "gemini-3.5-transcribe-live";
export type SpeechLanguage = "auto" | "en" | "ar";
export interface LiveCredential {
  token: string;
  apiVersion: "v1beta";
  model: typeof LIVE_MODEL;
  newSessionExpiresAt: string;
  expiresAt: string;
}
export type TokenIssuer = (language: SpeechLanguage, signal: AbortSignal) => Promise<LiveCredential>;

export function tokenParameters(language: SpeechLanguage, signal: AbortSignal, now = Date.now()): CreateAuthTokenParameters {
  return { config: {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    expireTime: new Date(now + 240_000).toISOString(),
    httpOptions: { apiVersion: "v1beta", timeout: 10_000 },
    abortSignal: signal,
    // Omit lockAdditionalFields: the SDK then locks the complete setup.
    liveConnectConstraints: {
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          mode: AudioTranscriptionConfigMode.VERBATIM,
          languageCodes: language === "auto" ? [] : [language === "en" ? "en-US" : "ar-EG"],
        },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      },
    },
  } };
}

export function createTokenIssuer(apiKey: string): TokenIssuer {
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  return async (language, signal) => {
    const parameters = tokenParameters(language, signal);
    const result = await client.authTokens.create(parameters);
    if (!result.name?.startsWith("auth_tokens/")) throw new Error("INVALID_UPSTREAM_RESPONSE");
    return {
      token: result.name, model: LIVE_MODEL, apiVersion: "v1beta",
      expiresAt: parameters.config!.expireTime!,
      newSessionExpiresAt: parameters.config!.newSessionExpireTime!,
    };
  };
}

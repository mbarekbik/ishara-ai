import type { CaptureOperation } from "../communication/interaction";
export type SpeechLanguage = "auto" | "en" | "ar";
export type VoiceStatus = "idle" | "requesting-permission" | "connecting" | "listening" | "finalizing" | "success" | "error";
export interface TranscriptDraft { finalText: string; interimText: string; language: string }
export interface SpeechService {
  kind?: "mock" | "service";
  begin: (input: {
    language: string;
    speechLanguage: SpeechLanguage;
    signal: AbortSignal;
    onPhase: (phase: VoiceStatus) => void;
    onDraft: (draft: TranscriptDraft) => void;
    onError: (code: string) => void;
  }) => Promise<CaptureOperation>;
}

import type { CaptureOperation } from "../communication/interaction";
export interface SpeechService {
  begin: (input: {
    language: string;
    signal: AbortSignal;
  }) => Promise<CaptureOperation>;
}

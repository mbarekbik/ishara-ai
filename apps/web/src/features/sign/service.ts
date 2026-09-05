import type { CaptureOperation } from "../communication/interaction";
export interface SignRecognitionService {
  begin: (input: {
    video: HTMLVideoElement | null;
    language: string;
    signal: AbortSignal;
  }) => Promise<CaptureOperation>;
}

import type { RecognitionResult } from "../communication/interaction";
import type { Message } from "../communication/model";
export interface AIService {
  reply: (input: {
    messages: readonly Message[];
    language: string;
    signal: AbortSignal;
  }) => Promise<RecognitionResult>;
}

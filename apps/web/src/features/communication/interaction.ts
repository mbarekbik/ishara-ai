export interface RecognitionResult {
  text: string;
  language: string;
  source: "mock" | "service";
  confidence?: number;
}
export interface CaptureOperation {
  finish: () => Promise<RecognitionResult>;
  cancel: () => void;
}
export type InteractionError = "serviceError" | "emptyResult";

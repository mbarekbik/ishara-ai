import type { LandmarkFrame, TrackingErrorCode } from "./model";
export interface FrameMetadata {
  trackingRunId: string;
  sequence: number;
  timestampMs: number;
  source: LandmarkFrame["source"];
}
export interface TrackingInput extends FrameMetadata { bitmap: ImageBitmap }
export interface LandmarkTracker {
  initialize(trackingRunId: string, signal: AbortSignal): Promise<void>;
  /** Takes ownership of bitmap, including when submission fails. */
  detect(input: TrackingInput): Promise<LandmarkFrame>;
  dispose(): Promise<void>;
}
export type LandmarkTrackerFactory = () => LandmarkTracker;
export type WorkerRequest =
  | { type: "initialize"; trackingRunId: string; delegate: "GPU" | "CPU"; baseUrl: string }
  | { type: "frame"; input: TrackingInput }
  | { type: "dispose" };
export type WorkerResponse =
  | { type: "ready"; trackingRunId: string }
  | { type: "result"; frame: LandmarkFrame }
  | { type: "error"; code: TrackingErrorCode }
  | { type: "disposed" };

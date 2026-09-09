/** Image coordinates refer to the complete, unmirrored source image. */
export type TrackingStatus = "idle" | "loading" | "ready" | "tracking" | "paused" | "error";
export type TrackingErrorCode = "trackingUnsupported" | "trackingPrivacyUnavailable" | "trackingAssetsUnavailable" | "trackingInitializationFailed" | "trackingVideoUnavailable" | "trackingInferenceFailed" | "trackingTooSlow";
export interface ImageLandmark { readonly x: number; readonly y: number; readonly z: number; readonly visibility?: number }
export interface WorldLandmark { readonly x: number; readonly y: number; readonly z: number; readonly visibility?: number }
export interface BodyLandmarks {
  readonly image: readonly ImageLandmark[];
  readonly world?: { readonly space: "pose-hips-meters"; readonly points: readonly WorldLandmark[] };
}
export interface LandmarkFrame {
  readonly schemaVersion: 1;
  readonly topology: "human-553-v1";
  /** Processing continuity only; never a person identifier. */
  readonly trackingRunId: string;
  readonly sequence: number;
  /** Video media time in milliseconds, strictly increasing within a run. */
  readonly timestampMs: number;
  readonly source: { readonly width: number; readonly height: number; readonly mirrored: false };
  readonly pose: BodyLandmarks | null;
  readonly leftHand: BodyLandmarks | null;
  readonly rightHand: BodyLandmarks | null;
  readonly face: { readonly image: readonly ImageLandmark[] } | null;
}
export type LandmarkFrameListener = (frame: LandmarkFrame) => void;
export class TrackingError extends Error {
  constructor(readonly code: TrackingErrorCode) { super(code); this.name = "TrackingError"; }
}

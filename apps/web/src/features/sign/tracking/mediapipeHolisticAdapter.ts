import type { HolisticLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { TrackingError, type BodyLandmarks, type ImageLandmark, type LandmarkFrame } from "./model";
import type { FrameMetadata } from "./service";

function points(groups: NormalizedLandmark[][], count: number, visibility: boolean): ImageLandmark[] | null {
  if (!Array.isArray(groups) || groups.length > 1) throw new TrackingError("trackingInferenceFailed");
  if (!groups.length || groups[0]?.length === 0) return null;
  const group = groups[0];
  if (!Array.isArray(group) || group.length !== count) throw new TrackingError("trackingInferenceFailed");
  return group.map((point) => {
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) throw new TrackingError("trackingInferenceFailed");
    if (visibility && point.visibility !== undefined && (!Number.isFinite(point.visibility) || point.visibility < 0 || point.visibility > 1)) throw new TrackingError("trackingInferenceFailed");
    return { x: point.x, y: point.y, z: point.z, ...(visibility && point.visibility !== undefined ? { visibility: point.visibility } : {}) };
  });
}
function body(imageGroups: NormalizedLandmark[][], worldGroups: NormalizedLandmark[][], count: number, visibility: boolean): BodyLandmarks | null {
  const image = points(imageGroups, count, visibility);
  const world = points(worldGroups, count, visibility);
  if (!image) {
    if (world) throw new TrackingError("trackingInferenceFailed");
    return null;
  }
  return { image, ...(world ? { world: { space: "pose-hips-meters" as const, points: world } } : {}) };
}
/** Pinned Holistic topology. Hand world coordinates are pose-wrist aligned. */
export function normalizeHolistic(result: HolisticLandmarkerResult, metadata: FrameMetadata): LandmarkFrame {
  const face = points(result.faceLandmarks, 478, false);
  return {
    schemaVersion: 1, topology: "human-553-v1", ...metadata,
    pose: body(result.poseLandmarks, result.poseWorldLandmarks, 33, true),
    leftHand: body(result.leftHandLandmarks, result.leftHandWorldLandmarks, 21, false),
    rightHand: body(result.rightHandLandmarks, result.rightHandWorldLandmarks, 21, false),
    face: face ? { image: face } : null,
  };
}

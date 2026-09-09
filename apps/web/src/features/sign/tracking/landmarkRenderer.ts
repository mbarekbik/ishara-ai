import type { ImageLandmark, LandmarkFrame } from "./model";
import { containGeometry, mapImageLandmark, type ImageGeometry } from "./overlayGeometry";
import { FACE_CONTOURS, HAND_CONNECTIONS, POSE_CONNECTIONS, type LandmarkConnection } from "./topology";

export function isOverlayFrameCurrent(frame: LandmarkFrame | null, video: Pick<HTMLVideoElement, "videoWidth" | "videoHeight" | "currentTime">): frame is LandmarkFrame {
  if (!frame || frame.source.width !== video.videoWidth || frame.source.height !== video.videoHeight) return false;
  const ageMs = video.currentTime * 1000 - frame.timestampMs;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 500;
}

function visible(point: ImageLandmark | undefined, requirePoseVisibility: boolean): point is ImageLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (!requirePoseVisibility || point.visibility === undefined || point.visibility >= 0.5);
}

function drawConnections(context: CanvasRenderingContext2D, points: readonly ImageLandmark[], connections: readonly LandmarkConnection[], geometry: ImageGeometry, color: string, width: number, pose = false) {
  context.beginPath();
  for (const [start, end] of connections) {
    const from = points[start];
    const to = points[end];
    if (!visible(from, pose) || !visible(to, pose)) continue;
    const a = mapImageLandmark(from, geometry);
    const b = mapImageLandmark(to, geometry);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.strokeStyle = "#233b34";
  context.lineWidth = width + 2;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawPoints(context: CanvasRenderingContext2D, points: readonly ImageLandmark[], geometry: ImageGeometry, radius: number, pose = false) {
  context.fillStyle = "#f1f4ed";
  context.strokeStyle = "#233b34";
  context.lineWidth = 1.5;
  for (const point of points) {
    if (!visible(point, pose)) continue;
    const at = mapImageLandmark(point, geometry);
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

/** Draw only the latest domain frame; no provider objects or temporal history. */
export function renderLandmarkFrame(context: CanvasRenderingContext2D, frame: LandmarkFrame | null, width: number, height: number, ratio: number): void {
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!frame) return;
  const geometry = containGeometry(frame.source.width, frame.source.height, width, height);
  if (!geometry) return;
  context.save();
  context.beginPath();
  context.rect(geometry.offsetX, geometry.offsetY, geometry.width, geometry.height);
  context.clip();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (frame.face) drawConnections(context, frame.face.image, FACE_CONTOURS, geometry, "#f1f4ed", 0.8);
  if (frame.pose) {
    drawConnections(context, frame.pose.image, POSE_CONNECTIONS, geometry, "#b8d7b1", 1.8, true);
    drawPoints(context, frame.pose.image, geometry, 2, true);
  }
  for (const hand of [frame.leftHand, frame.rightHand]) {
    if (!hand) continue;
    drawConnections(context, hand.image, HAND_CONNECTIONS, geometry, "#b8edc1", 2.5);
    drawPoints(context, hand.image, geometry, 3);
  }
  context.restore();
}

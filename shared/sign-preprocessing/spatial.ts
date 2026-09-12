import type { ImageLandmark, LandmarkFrame } from '../../apps/web/src/features/sign/tracking/model.ts';
import { FACE_INDICES, POSE_INDICES, POLICY } from './schema.ts';
import { requireValue } from './validation.ts';

export interface NormalizedFrame {
  timestampMs: number;
  body: boolean;
  hands: [number[] | null, number[] | null];
  wrists: [number[] | null, number[] | null];
  pose: (number[] | null)[];
  face: number[] | null;
}
const visible = (point: ImageLandmark) => point.visibility !== undefined && point.visibility >= POLICY.visibility;
export function normalizeFrame(frame: LandmarkFrame): NormalizedFrame {
  const { width, height } = frame.source;
  const shorterEdge = Math.min(width, height);
  const pixel = (point: ImageLandmark): [number, number] => [point.x * width, point.y * height];
  const shoulders = frame.pose?.image;
  const left = shoulders ? pixel(shoulders[11]) : [0, 0];
  const right = shoulders ? pixel(shoulders[12]) : [0, 0];
  const bodyScale = Math.hypot(right[0] - left[0], right[1] - left[1]);
  const body = !!shoulders && visible(shoulders[11]) && visible(shoulders[12]) && Number.isFinite(bodyScale) && bodyScale >= POLICY.minimumBodyScale * shorterEdge;
  const origin = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
  const bodyXY = (point: ImageLandmark): number[] => [(point.x * width - origin[0]) / bodyScale, (point.y * height - origin[1]) / bodyScale];
  const hands: NormalizedFrame['hands'] = [null, null];
  const wrists: NormalizedFrame['wrists'] = [null, null];
  for (const [side, component] of [frame.leftHand, frame.rightHand].entries()) {
    if (!component) continue;
    const wrist = component.image[0];
    const [wx, wy] = pixel(wrist);
    const distances = [5, 9, 13, 17].map(index => {
      const [x, y] = pixel(component.image[index]);
      return Math.hypot(x - wx, y - wy);
    }).sort((a, b) => a - b);
    const scale = (distances[1] + distances[2]) / 2;
    if (!Number.isFinite(scale) || scale < POLICY.minimumHandScale * shorterEdge) continue;
    hands[side] = component.image.flatMap(point => [
      (point.x * width - wx) / scale, (point.y * height - wy) / scale,
      ((point.z - wrist.z) * width) / scale,
    ]);
    if (body) wrists[side] = bodyXY(wrist);
  }
  const pose = POSE_INDICES.map(index => body && shoulders && visible(shoulders[index]) ? bodyXY(shoulders[index]) : null);
  const face = body && frame.face ? FACE_INDICES.flatMap(index => bodyXY(frame.face!.image[index])) : null;
  for (const values of [...hands, ...wrists, ...pose, face]) if (values) requireValue(values.every(Number.isFinite), 'NUMERIC_OVERFLOW', 'Normalization produced nonfinite values');
  return { timestampMs: frame.timestampMs, body, hands, wrists, pose, face };
}

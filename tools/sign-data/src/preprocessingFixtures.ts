import type { ImageLandmark, LandmarkFrame } from '../../../apps/web/src/features/sign/tracking/model.ts';

export function goldenFrame(timestampMs = 0, sequence = 1): LandmarkFrame {
  const point = (x: number, y: number, z = 0, visibility?: number): ImageLandmark => ({ x: x / 200, y: y / 100, z, ...(visibility === undefined ? {} : { visibility }) });
  const pose = Array.from({ length: 33 }, () => point(100, 40, 0, 1));
  pose[11] = point(60, 40, 0, 1); pose[12] = point(140, 40, 0, 1);
  pose[13] = point(50, 60, 0, 1);
  const hand = (x: number) => {
    const image = Array.from({ length: 21 }, () => point(x, 60, 0.2));
    image[1] = point(x + 10, 80, 0.25);
    [5, 9, 13, 17].forEach((index, i) => { image[index] = point(x + 10 * (i + 1), 60, 0.2); });
    return { image };
  };
  const face = Array.from({ length: 478 }, () => point(120, 20));
  return { schemaVersion: 1, topology: 'human-553-v1', trackingRunId: 'synthetic-turn', sequence,
    timestampMs, source: { width: 200, height: 100, mirrored: false },
    pose: { image: pose }, leftHand: hand(60), rightHand: hand(150), face: { image: face } };
}
export function goldenSequence(times = Array.from({ length: 11 }, (_, i) => i * 100)): LandmarkFrame[] {
  return times.map((time, i) => goldenFrame(time, i + 1));
}

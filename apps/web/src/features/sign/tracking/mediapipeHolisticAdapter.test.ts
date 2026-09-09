import type { HolisticLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, test } from 'vitest';
import { normalizeHolistic } from './mediapipeHolisticAdapter';
import type { FrameMetadata } from './service';

const metadata: FrameMetadata = {
  trackingRunId: 'synthetic-run', sequence: 3, timestampMs: 120,
  source: { width: 1280, height: 720, mirrored: false },
};

function points(count: number, x = 0.25): NormalizedLandmark[] {
  return Array.from({ length: count }, (_, index) => ({ x, y: index / count, z: -0.1, visibility: 0.8 }));
}

function result(): HolisticLandmarkerResult {
  return {
    faceLandmarks: [points(478)], faceBlendshapes: [],
    poseLandmarks: [points(33)], poseWorldLandmarks: [points(33, 0.01)], poseSegmentationMasks: [],
    leftHandLandmarks: [points(21, 0.2)], leftHandWorldLandmarks: [points(21, -0.4)],
    rightHandLandmarks: [points(21, 0.8)], rightHandWorldLandmarks: [points(21, 0.4)],
  };
}

describe('Holistic application-domain boundary', () => {
  test('keeps the pinned 553-point topology and originating frame metadata', () => {
    const frame = normalizeHolistic(result(), metadata);
    expect(frame).toMatchObject({ ...metadata, schemaVersion: 1, topology: 'human-553-v1' });
    expect(frame.face?.image).toHaveLength(478);
    expect(frame.pose?.image).toHaveLength(33);
    expect(frame.leftHand?.image).toHaveLength(21);
    expect(frame.rightHand?.image).toHaveLength(21);
    expect(frame.pose?.world?.space).toBe('pose-hips-meters');
    expect(frame.leftHand?.world?.space).toBe('pose-hips-meters');
    expect(frame.rightHand?.world?.space).toBe('pose-hips-meters');
  });

  test('preserves anatomical hand assignment and the already pose-aligned world coordinates', () => {
    const frame = normalizeHolistic(result(), metadata);
    expect(frame.leftHand?.image[0].x).toBe(0.2);
    expect(frame.rightHand?.image[0].x).toBe(0.8);
    expect(frame.leftHand?.world?.points[0].x).toBe(-0.4);
    expect(frame.rightHand?.world?.points[0].x).toBe(0.4);
    expect(frame.pose?.world?.points[0].x).toBe(0.01);
    expect(frame.source.mirrored).toBe(false);
  });

  test('copies only domain properties and keeps provider resources out of the frame', () => {
    const provider = result();
    Object.assign(provider.faceLandmarks[0][0], { providerOnly: 'discard', presence: 0.99 });
    const frame = normalizeHolistic(provider, metadata);
    expect(frame.face?.image).not.toBe(provider.faceLandmarks[0]);
    expect(frame.face?.image[0]).not.toBe(provider.faceLandmarks[0][0]);
    expect(frame.face?.image[0]).toEqual({ x: 0.25, y: 0, z: -0.1 });
    expect(Object.keys(frame).sort()).toEqual([
      'schemaVersion', 'topology', 'trackingRunId', 'sequence', 'timestampMs', 'source',
      'pose', 'leftHand', 'rightHand', 'face',
    ].sort());
    provider.leftHandLandmarks[0][0].x = 999;
    expect(frame.leftHand?.image[0].x).toBe(0.2);
  });

  test('preserves meaningful pose visibility and omits face/hand default visibility', () => {
    const provider = result();
    provider.poseLandmarks[0][0].visibility = 0;
    provider.poseWorldLandmarks[0][0].visibility = 1;
    provider.leftHandLandmarks[0][0].visibility = 0;
    const frame = normalizeHolistic(provider, metadata);
    expect(frame.pose?.image[0].visibility).toBe(0);
    expect(frame.pose?.world?.points[0].visibility).toBe(1);
    expect(frame.leftHand?.image[0]).not.toHaveProperty('visibility');
    expect(frame.leftHand?.world?.points[0]).not.toHaveProperty('visibility');
    expect(frame.rightHand?.image[0]).not.toHaveProperty('visibility');
    expect(frame.face?.image[0]).not.toHaveProperty('visibility');
  });

  test('preserves finite out-of-frame coordinates and component-relative depth', () => {
    const provider = result();
    provider.poseLandmarks[0][0] = { x: -0.3, y: 1.2, z: -7, visibility: 0.8 };
    expect(normalizeHolistic(provider, metadata).pose?.image[0]).toEqual(provider.poseLandmarks[0][0]);
  });

  test('represents no detections as null parts and permits absent optional world data', () => {
    const provider = result();
    provider.faceLandmarks = [[]];
    provider.leftHandLandmarks = [];
    provider.leftHandWorldLandmarks = [];
    provider.rightHandLandmarks = [[]];
    provider.rightHandWorldLandmarks = [[]];
    provider.poseWorldLandmarks = [];
    const frame = normalizeHolistic(provider, metadata);
    expect(frame.face).toBeNull();
    expect(frame.leftHand).toBeNull();
    expect(frame.rightHand).toBeNull();
    expect(frame.pose?.image).toHaveLength(33);
    expect(frame.pose).not.toHaveProperty('world');
    provider.poseLandmarks = [];
    expect(normalizeHolistic(provider, metadata).pose).toBeNull();
  });

  test.each([
    'faceLandmarks', 'poseLandmarks', 'poseWorldLandmarks',
    'leftHandLandmarks', 'leftHandWorldLandmarks', 'rightHandLandmarks', 'rightHandWorldLandmarks',
  ] as const)('rejects incorrect nonempty topology in %s', (field) => {
    const provider = result();
    provider[field][0].pop();
    expect(() => normalizeHolistic(provider, metadata)).toThrow('trackingInferenceFailed');
  });

  test.each([NaN, Infinity, -Infinity])('rejects nonfinite point coordinates (%s)', (value) => {
    for (const coordinate of ['x', 'y', 'z'] as const) {
      const provider = result();
      provider.faceLandmarks[0][0][coordinate] = value;
      expect(() => normalizeHolistic(provider, metadata)).toThrow('trackingInferenceFailed');
    }
  });

  test.each([NaN, -0.01, 1.01])('rejects invalid pose visibility (%s)', (visibility) => {
    const provider = result();
    provider.poseWorldLandmarks[0][0].visibility = visibility;
    expect(() => normalizeHolistic(provider, metadata)).toThrow('trackingInferenceFailed');
  });

  test('rejects multiple people and orphaned world points', () => {
    const multiple = result();
    multiple.faceLandmarks.push(points(478));
    expect(() => normalizeHolistic(multiple, metadata)).toThrow('trackingInferenceFailed');
    const orphaned = result();
    orphaned.leftHandLandmarks = [];
    expect(() => normalizeHolistic(orphaned, metadata)).toThrow('trackingInferenceFailed');
  });
});

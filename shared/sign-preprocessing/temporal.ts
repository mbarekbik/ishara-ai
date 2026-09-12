import { POLICY, SEQUENCE_LENGTH } from './schema.ts';
import type { NormalizedFrame } from './spatial.ts';

export const COMPONENTS = ['body', 'leftHand', 'rightHand', 'leftWrist', 'rightWrist', 'pose11', 'pose12', 'pose13', 'pose14', 'pose15', 'pose16', 'face'] as const;
export type Component = typeof COMPONENTS[number];
export function available(frame: NormalizedFrame, key: Component): boolean {
  if (key === 'body') return frame.body;
  if (key === 'face') return frame.face !== null;
  if (key === 'leftHand' || key === 'rightHand') return frame.hands[key === 'leftHand' ? 0 : 1] !== null;
  if (key === 'leftWrist' || key === 'rightWrist') return frame.wrists[key === 'leftWrist' ? 0 : 1] !== null;
  return frame.pose[Number(key.slice(4)) - 11] !== null;
}
export function supported(a: NormalizedFrame, b: NormalizedFrame, key: Component): boolean {
  return b.timestampMs - a.timestampMs <= POLICY.maxInterpolationGapMs && available(a, key) && available(b, key);
}
export function coverageMetrics(frames: readonly NormalizedFrame[]) {
  const durationMs = frames.at(-1)!.timestampMs - frames[0].timestampMs;
  const durations = Object.fromEntries(COMPONENTS.map(key => [key, 0])) as Record<Component, number>;
  let anyHandDuration = 0;
  let largestSourceGapMs = 0;
  let unsupportedLargeGapDurationMs = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    const gap = b.timestampMs - a.timestampMs;
    largestSourceGapMs = Math.max(largestSourceGapMs, gap);
    if (gap > POLICY.maxInterpolationGapMs) unsupportedLargeGapDurationMs += gap;
    for (const key of COMPONENTS) if (supported(a, b, key)) durations[key] += gap;
    if (supported(a, b, 'leftHand') || supported(a, b, 'rightHand')) anyHandDuration += gap;
  }
  const fraction = (duration: number) => durationMs > 0 ? duration / durationMs : 0;
  const byComponent = Object.fromEntries(COMPONENTS.map(key => [key, fraction(durations[key])])) as Record<Component, number>;
  return {
    bodyAnchorCoverage: byComponent.body, leftHandCoverage: byComponent.leftHand, rightHandCoverage: byComponent.rightHand,
    anyHandCoverage: fraction(anyHandDuration), faceCoverage: byComponent.face,
    poseCoverage: [11, 12, 13, 14, 15, 16].reduce((sum, index) => sum + byComponent[`pose${index}` as Component], 0) / 6,
    componentCoverage: byComponent, supportedMilliseconds: durations, anyHandSupportedMilliseconds: anyHandDuration,
    largestSourceGapMs, unsupportedLargeGapDurationMs,
    missingSourceObservations: Object.fromEntries(COMPONENTS.map(key => [key, frames.filter(frame => !available(frame, key)).length])),
  };
}
const interpolate = (a: number[] | null, b: number[] | null, alpha: number, allowed: boolean): number[] | null =>
  allowed && a && b ? a.map((value, index) => value * (1 - alpha) + b[index] * alpha) : null;

export function resampleFrames(frames: readonly NormalizedFrame[]) {
  const start = frames[0].timestampMs, end = frames.at(-1)!.timestampMs;
  let cursor = 0;
  let exactObservations = 0;
  let interpolatedPositions = 0;
  let largeGapPositions = 0;
  const output: NormalizedFrame[] = [];
  for (let index = 0; index < SEQUENCE_LENGTH; index++) {
    const time = index === SEQUENCE_LENGTH - 1 ? end : start + ((end - start) * index) / (SEQUENCE_LENGTH - 1);
    while (cursor + 1 < frames.length && frames[cursor + 1].timestampMs <= time) cursor++;
    const a = frames[cursor];
    if (a.timestampMs === time) { output.push(a); exactObservations++; continue; }
    const b = frames[cursor + 1];
    const allowed = !!b && b.timestampMs - a.timestampMs <= POLICY.maxInterpolationGapMs;
    const alpha = b ? (time - a.timestampMs) / (b.timestampMs - a.timestampMs) : 0;
    if (allowed) interpolatedPositions++; else largeGapPositions++;
    output.push({
      timestampMs: time, body: allowed && a.body && b.body,
      hands: [interpolate(a.hands[0], b?.hands[0] ?? null, alpha, allowed), interpolate(a.hands[1], b?.hands[1] ?? null, alpha, allowed)],
      wrists: [interpolate(a.wrists[0], b?.wrists[0] ?? null, alpha, allowed), interpolate(a.wrists[1], b?.wrists[1] ?? null, alpha, allowed)],
      pose: a.pose.map((values, i) => interpolate(values, b?.pose[i] ?? null, alpha, allowed)),
      face: interpolate(a.face, b?.face ?? null, alpha, allowed),
    });
  }
  return { frames: output, statistics: {
    exactObservations, interpolatedPositions, largeGapPositions,
    supportedResampledPositions: Object.fromEntries(COMPONENTS.map(key => [key, output.filter(frame => available(frame, key)).length])),
  } };
}

/** A sparse output grid must not hide an intervening missing wrist or an unsupported source gap. */
export function wristIntervalSupported(source: readonly NormalizedFrame[], startMs: number, endMs: number, side: number): boolean {
  const key = side === 0 ? 'leftWrist' : 'rightWrist';
  for (let i = 1; i < source.length; i++) {
    const a = source[i - 1], b = source[i];
    if (b.timestampMs > startMs && a.timestampMs < endMs && !supported(a, b, key)) return false;
  }
  return true;
}

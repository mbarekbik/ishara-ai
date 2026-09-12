import { FEATURE_WIDTH, OFFSETS, POLICY, PREPROCESSING_VERSION, SEQUENCE_LENGTH } from './schema.ts';
import { normalizeFrame } from './spatial.ts';
import { coverageMetrics, resampleFrames, wristIntervalSupported } from './temporal.ts';
import { requireValue, validateSequence } from './validation.ts';
import type { LandmarkFrame } from './validation.ts';

export function qualityFailures(durationSeconds: number, bodyCoverage: number, handCoverage: number): string[] {
  const reasons: string[] = [];
  if (durationSeconds < POLICY.minimumDurationSeconds) reasons.push('DURATION_BELOW_0_75_SECONDS');
  if (durationSeconds > POLICY.maximumDurationSeconds) reasons.push('DURATION_ABOVE_10_SECONDS');
  if (bodyCoverage < POLICY.minimumBodyCoverage) reasons.push('BODY_ANCHOR_COVERAGE_BELOW_85_PERCENT');
  if (handCoverage < POLICY.minimumAnyHandCoverage) reasons.push('ANY_HAND_COVERAGE_BELOW_70_PERCENT');
  return reasons;
}

export function preprocessSequence(frames: readonly LandmarkFrame[], version: string = PREPROCESSING_VERSION) {
  requireValue(version === PREPROCESSING_VERSION, 'INCOMPATIBLE_PREPROCESSING', 'Unsupported preprocessing version');
  validateSequence(frames);
  const normalized = frames.map(normalizeFrame);
  const sourceDurationSeconds = (frames.at(-1)!.timestampMs - frames[0].timestampMs) / 1000;
  const metrics = coverageMetrics(normalized);
  const failureReasons = qualityFailures(sourceDurationSeconds, metrics.bodyAnchorCoverage, metrics.anyHandCoverage);
  const warnings: string[] = [];
  if (metrics.largestSourceGapMs > POLICY.maxInterpolationGapMs) warnings.push('SOURCE_GAPS_EXCEED_250_MS');
  if (metrics.faceCoverage < 1) warnings.push('FACE_NOT_SUPPORTED_FOR_ENTIRE_TURN');
  if (metrics.leftHandCoverage < 1 || metrics.rightHandCoverage < 1) warnings.push('MISSING_OR_UNUSABLE_HAND_OBSERVATIONS');
  const resampled = resampleFrames(normalized);
  // Float64 intermediate arithmetic avoids rounding each interpolation step. Cast only the final tensor.
  const tensor = new Float32Array(SEQUENCE_LENGTH * FEATURE_WIDTH);
  for (const [index, frame] of resampled.frames.entries()) {
    const base = index * FEATURE_WIDTH;
    const put = (offset: number, values: readonly number[] | null, mask?: number) => {
      if (values) {
        values.forEach((value, i) => {
          requireValue(Number.isFinite(value) && Number.isFinite(Math.fround(value)), 'FLOAT32_OVERFLOW', 'Feature cannot be represented as finite Float32');
          tensor[base + offset + i] = value;
        });
        if (mask !== undefined) tensor[base + mask] = 1;
      }
    };
    put(OFFSETS.leftHand, frame.hands[0], OFFSETS.leftHandMask);
    put(OFFSETS.rightHand, frame.hands[1], OFFSETS.rightHandMask);
    put(OFFSETS.leftWrist, frame.wrists[0]); put(OFFSETS.rightWrist, frame.wrists[1]);
    frame.pose.forEach((values, point) => put(OFFSETS.pose + 2 * point, values, OFFSETS.poseMasks + point));
    put(OFFSETS.face, frame.face, OFFSETS.faceMask);
    if (index > 0) for (const side of [0, 1]) {
      const previous = resampled.frames[index - 1];
      const a = previous.wrists[side], b = frame.wrists[side];
      const dt = (frame.timestampMs - previous.timestampMs) / 1000;
      if (dt > 0 && a && b && wristIntervalSupported(normalized, previous.timestampMs, frame.timestampMs, side)) {
        put(side === 0 ? OFFSETS.leftVelocity : OFFSETS.rightVelocity, b.map((value, i) => (value - a[i]) / dt), side === 0 ? OFFSETS.leftVelocityMask : OFFSETS.rightVelocityMask);
      }
    }
    put(OFFSETS.duration, [sourceDurationSeconds / 10]);
  }
  return {
    qualityStatus: failureReasons.length ? 'FAIL' as const : 'PASS' as const,
    tensor: failureReasons.length ? null : tensor,
    timestampsMs: resampled.frames.map(frame => frame.timestampMs), sourceDurationSeconds,
    metrics: { ...metrics, sourceObservationCount: frames.length, interpolation: resampled.statistics },
    failureReasons, warnings,
  };
}
export type PreprocessingResult = ReturnType<typeof preprocessSequence>;

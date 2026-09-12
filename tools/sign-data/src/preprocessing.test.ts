import assert from 'node:assert/strict';
import test from 'node:test';
import { FEATURE_WIDTH, SEQUENCE_LENGTH, OFFSETS, LAYOUT, PREPROCESSING_VERSION } from '../../../shared/sign-preprocessing/schema.ts';
import { normalizeFrame } from '../../../shared/sign-preprocessing/spatial.ts';
import { coverageMetrics, resampleFrames, wristIntervalSupported } from '../../../shared/sign-preprocessing/temporal.ts';
import { preprocessSequence, qualityFailures } from '../../../shared/sign-preprocessing/preprocess.ts';
import { PreprocessingError, validateSequence } from '../../../shared/sign-preprocessing/validation.ts';
import type { LandmarkFrame } from '../../../shared/sign-preprocessing/validation.ts';
import { goldenFrame, goldenSequence } from './preprocessingFixtures.ts';

const close = (actual: number, expected: number, tolerance = 1e-6) => assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const replace = (frame: LandmarkFrame, changes: Partial<LandmarkFrame>): LandmarkFrame => ({ ...frame, ...changes });
const invalid = (frames: LandmarkFrame[], code: string) => assert.throws(() => preprocessSequence(frames), error => error instanceof PreprocessingError && error.code === code);

test('feature layout covers every slot exactly once with frozen offsets', () => {
  assert.equal(FEATURE_WIDTH, 170); assert.equal(SEQUENCE_LENGTH, 64);
  assert.deepEqual(LAYOUT.flatMap(group => Array.from({ length: group.width }, (_, i) => group.offset + i)), Array.from({ length: 170 }, (_, i) => i));
  assert.deepEqual(Object.values(OFFSETS), [0, 63, 126, 128, 130, 142, 154, 156, 158, 159, 160, 166, 167, 168, 169]);
});
test('golden body midpoint/scale and pose/face subsets use pixel geometry', () => {
  const normalized = normalizeFrame(goldenFrame());
  assert.equal(normalized.body, true);
  assert.deepEqual(normalized.wrists[0], [-0.5, 0.25]);
  assert.deepEqual(normalized.wrists[1], [0.625, 0.25]);
  assert.deepEqual(normalized.pose.slice(0, 3), [[-0.5, 0], [0.5, 0], [-0.625, 0.25]]);
  assert.deepEqual(normalized.face, Array.from({ length: 6 }, () => [0.25, -0.25]).flat());
});
test('hand median scale is average middle MCP distances and Z uses source width', () => {
  const values = normalizeFrame(goldenFrame()).hands[0]!;
  assert.deepEqual(values.slice(0, 3), [0, 0, 0]);
  close(values[3], 0.4); close(values[4], 0.8); close(values[5], 0.4);
  close(values[5 * 3], 0.4); close(values[9 * 3], 0.8); close(values[13 * 3], 1.2); close(values[17 * 3], 1.6);
});
test('aspect changes use independent pixel X/Y scaling', () => {
  const frame = goldenFrame();
  const normal = normalizeFrame({ ...frame, source: { ...frame.source, width: 400 } });
  close(normal.hands[0]![3], 0.4); close(normal.hands[0]![4], 0.4); close(normal.hands[0]![5], 0.4);
  close(normal.wrists[0]![1], 0.125);
});
test('minimum shoulder scale is inclusive and meaningful visibility is required', () => {
  const base = goldenFrame();
  const resized = (distance: number) => replace(base, { pose: { image: base.pose!.image.map((p, i) => i === 12 ? { ...p, x: 0.3 + distance / 200 } : p) } });
  assert(normalizeFrame(resized(10.000001)).body);
  assert(!normalizeFrame(resized(9.99)).body);
  const threshold = replace(base, { pose: { image: base.pose!.image.map(p => ({ ...p, visibility: 0.5 })) } });
  assert(normalizeFrame(threshold).body);
  const hidden = replace(base, { pose: { image: base.pose!.image.map(p => ({ ...p, visibility: undefined })) } });
  assert(!normalizeFrame(hidden).body); assert(normalizeFrame(hidden).hands[0]); assert.equal(normalizeFrame(hidden).wrists[0], null);
  assert.equal(normalizeFrame(hidden).face, null);
});
test('tiny hand scale rejects hand and wrist, without inferring from other hand', () => {
  const base = goldenFrame();
  const hand = { image: base.leftHand!.image.map(p => ({ ...p, x: base.leftHand!.image[0].x, y: base.leftHand!.image[0].y })) };
  const frame = normalizeFrame(replace(base, { leftHand: hand }));
  assert.equal(frame.hands[0], null); assert.equal(frame.wrists[0], null); assert(frame.hands[1]);
});
test('1.5% hand-scale boundary is inclusive', () => {
  const base = goldenFrame();
  const make = (distance: number) => normalizeFrame(replace(base, { leftHand: { image: base.leftHand!.image.map((p, i) => [5, 9, 13, 17].includes(i) ? { ...p, x: distance / 200, y: 0 } : i === 0 ? { ...p, x: 0, y: 0 } : p) } }));
  assert(make(1.5).hands[0]); assert.equal(make(1.499).hands[0], null);
});
test('anatomical left and right do not swap and body positions are not mirrored', () => {
  const result = preprocessSequence(goldenSequence()); const tensor = result.tensor!;
  close(tensor[OFFSETS.leftWrist], -0.5); close(tensor[OFFSETS.rightWrist], 0.625);
  const rightMissing = preprocessSequence(goldenSequence().map(frame => replace(frame, { rightHand: null })));
  assert(rightMissing.tensor); assert.equal(rightMissing.tensor[OFFSETS.leftHandMask], 1);
  assert.equal(rightMissing.tensor[OFFSETS.rightHandMask], 0);
  assert(rightMissing.tensor.slice(63, 126).every(value => value === 0));
});
test('missing pose points and face have zero values and independent masks', () => {
  const source = goldenSequence().map(frame => replace(frame, { face: null, pose: { image: frame.pose!.image.map((p, i) => i === 13 ? { ...p, visibility: 0.49 } : p) } }));
  const tensor = preprocessSequence(source).tensor!;
  assert(tensor); assert.equal(tensor[OFFSETS.poseMasks + 2], 0);
  assert.equal(tensor[OFFSETS.pose + 4], 0); assert.equal(tensor[OFFSETS.faceMask], 0);
  assert(tensor.slice(OFFSETS.face, OFFSETS.face + 12).every(value => value === 0));
});
test('uniform grid includes media-time endpoints and does not use array-index interpolation', () => {
  const times = [1000, 1100, 1350, 1500, 1700, 1900, 2000];
  const frames = goldenSequence(times).map(frame => replace(frame, { leftHand: { image: frame.leftHand!.image.map(p => ({ ...p, x: p.x + (frame.timestampMs - 1000) / 10000 })) } }));
  const result = preprocessSequence(frames);
  assert.equal(result.timestampsMs.length, 64); assert.equal(result.timestampsMs[0], 1000); assert.equal(result.timestampsMs[63], 2000);
  for (let i = 0; i < 64; i++) {
    close(result.timestampsMs[i], 1000 + i * 1000 / 63);
    close(result.tensor![i * 170 + OFFSETS.leftWrist], -0.5 + (i / 63) * 0.25);
    close(result.tensor![i * 170 + OFFSETS.duration], 0.1);
  }
});
test('250ms intervals support interpolation; greater intervals never bridge', () => {
  const accepted = preprocessSequence(goldenSequence([0, 250, 500, 750, 1000])); assert.equal(accepted.qualityStatus, 'PASS');
  const frames = goldenSequence([0, 251, 500, 750, 1000]).map(normalizeFrame);
  const output = resampleFrames(frames);
  assert.equal(output.frames[1].hands[0], null); assert.equal(output.frames[1].body, false);
  close(coverageMetrics(frames).bodyAnchorCoverage, 0.749);
  assert(output.statistics.largeGapPositions > 0);
});
test('explicit missing anatomy is not bridged or extrapolated', () => {
  const frames = goldenSequence([0, 100, 200, 300, 400]).map((frame, i) => normalizeFrame(i === 0 || i === 2 || i === 4 ? replace(frame, { leftHand: null }) : frame));
  const output = resampleFrames(frames).frames;
  assert.equal(output[0].hands[0], null); assert.equal(output[63].hands[0], null);
  assert.equal(output[1].hands[0], null); assert.equal(output[31].hands[0], null);
  assert.equal(coverageMetrics(frames).leftHandCoverage, 0);
});
test('velocities follow resampling in actual seconds; first velocity is explicitly missing', () => {
  const source = goldenSequence().map(frame => replace(frame, { leftHand: { image: frame.leftHand!.image.map(p => ({ ...p, x: p.x + frame.timestampMs / 10000 })) } }));
  const tensor = preprocessSequence(source).tensor!;
  assert.equal(tensor[OFFSETS.leftVelocity], 0); assert.equal(tensor[OFFSETS.leftVelocityMask], 0);
  for (let i = 1; i < 64; i++) { close(tensor[i * 170 + OFFSETS.leftVelocity], 0.25); close(tensor[i * 170 + OFFSETS.leftVelocity + 1], 0); assert.equal(tensor[i * 170 + OFFSETS.leftVelocityMask], 1); }
});
test('velocity cannot jump over an unobserved wrist even if output endpoints are available', () => {
  const source = goldenSequence([0, 50, 100, 150, 200]).map((frame, i) => normalizeFrame(i === 2 ? replace(frame, { leftHand: null }) : frame));
  assert.equal(wristIntervalSupported(source, 0, 200, 0), false);
  assert.equal(wristIntervalSupported(source, 0, 200, 1), true);
  const frames = goldenSequence().map((frame, i) => i === 5 ? replace(frame, { leftHand: null }) : frame);
  const tensor = preprocessSequence(frames).tensor!;
  for (let i = 27; i < 39; i++) assert.equal(tensor[i * 170 + OFFSETS.leftVelocityMask], 0);
});
test('coverage is time-weighted supported intervals, not observation counts', () => {
  const source = goldenSequence([0, 50, 100, 200, 450, 700, 950, 1000]).map((frame, i) => normalizeFrame(i === 1 ? replace(frame, { pose: null }) : frame));
  close(coverageMetrics(source).bodyAnchorCoverage, 0.9);
  const switched = goldenSequence([0, 100, 200]).map((frame, i) => normalizeFrame(replace(frame, i === 1 ? { leftHand: null } : { rightHand: null })));
  assert.equal(coverageMetrics(switched).anyHandCoverage, 0, 'Different singleton hands must not establish supported intervals');
});
test('quality threshold comparisons include 85% and 70% and retain fixed reasons', () => {
  assert.deepEqual(qualityFailures(0.75, 0.85, 0.70), []); assert.deepEqual(qualityFailures(10, 1, 1), []);
  assert.deepEqual(qualityFailures(0.749, 0.849999, 0.699999), ['DURATION_BELOW_0_75_SECONDS', 'BODY_ANCHOR_COVERAGE_BELOW_85_PERCENT', 'ANY_HAND_COVERAGE_BELOW_70_PERCENT']);
  assert.deepEqual(qualityFailures(10.001, 1, 1), ['DURATION_ABOVE_10_SECONDS']);
});
test('sequence quality evaluates actual time coverage at exact policy boundaries', () => {
  const times = [0, 50, 100, 200, 350, 500, 700, 900, 1000];
  const frames = goldenSequence(times).map(frame => replace(frame, {
    ...(frame.timestampMs === 100 ? { pose: null } : {}),
    ...(frame.timestampMs === 350 ? { leftHand: null, rightHand: null } : {}),
  }));
  const result = preprocessSequence(frames);
  close(result.metrics.bodyAnchorCoverage, 0.85); close(result.metrics.anyHandCoverage, 0.7);
  assert.equal(result.qualityStatus, 'PASS');
});
test('quality failures preserve diagnostics without producing training-eligible tensors', () => {
  const result = preprocessSequence(goldenSequence().map(frame => replace(frame, { leftHand: null, rightHand: null })));
  assert.equal(result.tensor, null); assert.equal(result.qualityStatus, 'FAIL');
  assert.deepEqual(result.failureReasons, ['ANY_HAND_COVERAGE_BELOW_70_PERCENT']);
  assert.equal(result.metrics.bodyAnchorCoverage, 1);
});
test('complete turn duration is retained; no automatic trimming or truncation', () => {
  const tooLong = preprocessSequence(goldenSequence(Array.from({ length: 42 }, (_, i) => i * 250)));
  assert(tooLong.failureReasons.includes('DURATION_ABOVE_10_SECONDS')); assert.equal(tooLong.tensor, null);
  assert.equal(tooLong.sourceDurationSeconds, 10.25); assert.equal(tooLong.timestampsMs.at(-1), 10250);
  assert(preprocessSequence([goldenFrame()]).failureReasons.includes('DURATION_BELOW_0_75_SECONDS'));
});
test('input schema, order, geometry, run and mirroring fail closed', () => {
  const frame = goldenFrame();
  invalid([replace(frame, { schemaVersion: 2 as 1 })], 'INCOMPATIBLE_SCHEMA');
  invalid([replace(frame, { topology: 'other' as 'human-553-v1' })], 'INCOMPATIBLE_SCHEMA');
  invalid([frame, goldenFrame(0, 2)], 'INVALID_TIMESTAMPS');
  invalid([frame, goldenFrame(100, 1)], 'INVALID_SEQUENCE');
  invalid([frame, replace(goldenFrame(100, 2), { source: { ...frame.source, width: 400 } })], 'CHANGED_GEOMETRY');
  invalid([replace(frame, { source: { ...frame.source, mirrored: true as false } })], 'MIRRORED_SOURCE');
  invalid([frame, replace(goldenFrame(100, 2), { trackingRunId: 'another' })], 'INVALID_RUN');
  assert.throws(() => preprocessSequence([frame], PREPROCESSING_VERSION + '-unknown'), /Unsupported preprocessing version/);
});
test('NaN, Infinity, invalid topology and Float32 overflow cannot enter outputs', () => {
  const base = goldenFrame();
  for (const value of [NaN, Infinity, -Infinity]) invalid([replace(base, { leftHand: { image: base.leftHand!.image.map((p, i) => i === 1 ? { ...p, z: value } : p) } })], 'NONFINITE_INPUT');
  invalid([replace(base, { face: { image: [] } })], 'INVALID_TOPOLOGY');
  const overflowing = goldenSequence().map(frame => replace(frame, { leftHand: { image: frame.leftHand!.image.map((p, i) => i === 1 ? { ...p, z: 1e39 } : p) } }));
  invalid(overflowing, 'FLOAT32_OVERFLOW');
});
test('world coordinates do not change features but invalid world numeric data is rejected', () => {
  const base = goldenSequence();
  const world = base.map(frame => replace(frame, { leftHand: { ...frame.leftHand!, world: { space: 'pose-hips-meters', points: frame.leftHand!.image.map(p => ({ ...p, x: 999, y: 500, z: -333 })) } } }));
  assert.deepEqual(preprocessSequence(world).tensor, preprocessSequence(base).tensor);
  assert.throws(() => validateSequence([replace(base[0], { pose: { ...base[0].pose!, world: { space: 'pose-hips-meters', points: base[0].pose!.image.map(p => ({ ...p, z: Infinity })) } } })]), /finite/);
});
test('Float32 conversion is final, deterministic, finite and does not mutate source', () => {
  const input = goldenSequence(); const before = JSON.stringify(input);
  const first = preprocessSequence(input), second = preprocessSequence(input);
  assert.deepEqual(first, second); assert(first.tensor instanceof Float32Array); assert.equal(first.tensor.length, 10880);
  assert(first.tensor.every(Number.isFinite)); assert.equal(first.tensor[3], Math.fround(0.4));
  assert.equal(JSON.stringify(input), before);
});

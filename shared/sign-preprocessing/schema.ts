/** Changing any numerical or availability policy requires a new preprocessing identity. */
export const PREPROCESSING_VERSION = 'sign-features-170-v1';
export const FEATURE_SCHEMA_VERSION = 'anatomical-170-v1';
export const SEQUENCE_LENGTH = 64;
export const FEATURE_WIDTH = 170;
export const POSE_INDICES = [11, 12, 13, 14, 15, 16] as const;
export const FACE_INDICES = [1, 33, 263, 13, 14, 152] as const;
export const OFFSETS = Object.freeze({
  leftHand: 0, rightHand: 63, leftWrist: 126, rightWrist: 128,
  pose: 130, face: 142, leftVelocity: 154, rightVelocity: 156,
  leftHandMask: 158, rightHandMask: 159, poseMasks: 160, faceMask: 166,
  leftVelocityMask: 167, rightVelocityMask: 168, duration: 169,
});
export const LAYOUT = [
  { name: 'leftHand', offset: OFFSETS.leftHand, width: 63, order: 'landmark 0..20, XYZ' },
  { name: 'rightHand', offset: OFFSETS.rightHand, width: 63, order: 'landmark 0..20, XYZ' },
  { name: 'leftWrist', offset: OFFSETS.leftWrist, width: 2, order: 'XY' },
  { name: 'rightWrist', offset: OFFSETS.rightWrist, width: 2, order: 'XY' },
  { name: 'pose', offset: OFFSETS.pose, width: 12, order: '11,12,13,14,15,16; XY' },
  { name: 'face', offset: OFFSETS.face, width: 12, order: '1,33,263,13,14,152; XY' },
  { name: 'leftVelocity', offset: OFFSETS.leftVelocity, width: 2, order: 'XY / second' },
  { name: 'rightVelocity', offset: OFFSETS.rightVelocity, width: 2, order: 'XY / second' },
  { name: 'leftHandMask', offset: OFFSETS.leftHandMask, width: 1 },
  { name: 'rightHandMask', offset: OFFSETS.rightHandMask, width: 1 },
  { name: 'poseMasks', offset: OFFSETS.poseMasks, width: 6, order: '11,12,13,14,15,16' },
  { name: 'faceMask', offset: OFFSETS.faceMask, width: 1 },
  { name: 'leftVelocityMask', offset: OFFSETS.leftVelocityMask, width: 1 },
  { name: 'rightVelocityMask', offset: OFFSETS.rightVelocityMask, width: 1 },
  { name: 'duration', offset: OFFSETS.duration, width: 1, order: 'media duration seconds / 10' },
] as const;
export const POLICY = Object.freeze({
  visibility: 0.5, minimumBodyScale: 0.10, minimumHandScale: 0.015,
  maxInterpolationGapMs: 250, minimumDurationSeconds: 0.75, maximumDurationSeconds: 10,
  minimumBodyCoverage: 0.85, minimumAnyHandCoverage: 0.70,
});
export const CONTRACT = {
  preprocessingVersion: PREPROCESSING_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  landmarkFrame: { schemaVersion: 1, topology: 'human-553-v1', mirrored: false },
  temporalResamplingVersion: 'uniform64-adjacent-supported-v1',
  qualityPolicyVersion: 'supported-time-85body-70hand-v1',
  sequenceLength: SEQUENCE_LENGTH, featureWidth: FEATURE_WIDTH, featureLayout: LAYOUT,
  bodyNormalization: 'Pixel XY; midpoint of visible pose shoulders 11/12; shoulder distance >= 10% of shorter image edge. Selected pose points require visibility >=0.5, including shoulders. Missing visibility is invalid.',
  handNormalization: 'Pixel XY relative to wrist 0; scale = arithmetic median of four wrist-to-MCP 5/9/13/17 distances, >=1.5% shorter edge. Z=(point.z-wrist.z)*sourceWidth/scale. No world coordinates.',
  missingData: 'Zero values and zero component masks. Hand-local validity is independent of body. Wrist-body availability requires its hand mask AND both shoulder masks. Face subset is all-or-none and requires body anchors. No rotation, mirroring, hand swapping, or inferred anatomy.',
  resampling: '64 uniform media timestamps including first/last. Normalize each source frame, then linear interpolation of each component between adjacent valid endpoints only, gap <=250ms. Exact observations retained; no extrapolation or rest trimming.',
  velocity: 'Backward difference after resampling, in body-normalized XY per second; first timestep zero/mask0. Both wrist endpoints and every intersected source interval must support the wrist, with no missing observation or gap >250ms.',
  coverage: 'Supported adjacent interval duration / full turn duration, gap <=250ms. A component supports an interval only if valid at both ends. Any hand is the union of intervals supported by the same left or right hand; complementary singleton detections do not bridge missing hands. Pose coverage is mean of six point time coverages.',
  duration: 'Last minus first media timestamp; inclusive 0.75..10 seconds. Feature is seconds/10, repeated. Never truncate.',
  policies: POLICY,
} as const;

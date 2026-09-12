# Shared sign preprocessing, version 1

This directory is the single authoritative mathematical implementation for offline tools and future browser callers. It is a small source module, without a workspace package or build pipeline. `preprocessSequence` imports only pure TypeScript helpers. The existing Scope 4 `LandmarkFrame` is reused through type-only imports; no provider, DOM, Node, React, camera, or storage code is loaded. `tools/sign-data` alone owns private filesystem reads, serialization and manifests. Production does not call this module yet.

`preprocessSequence(frames, version?)` validates a complete observation sequence and returns quality metrics, 64 media timestamps, warnings, failure reasons and a Float32Array only on PASS. Invalid schemas, numeric values, order or geometry throw `PreprocessingError` with a stable code. Quality failures return FAIL with no tensor. Inputs are not mutated. Intermediate arithmetic uses JavaScript numbers; conversion to finite Float32 occurs only at tensor construction.

Versions: source schema 1 / `human-553-v1`; preprocessing `sign-features-170-v1`; layout `anatomical-170-v1`; resampling `uniform64-adjacent-supported-v1`; quality `supported-time-85body-70hand-v1`. Any change to formulas, feature order, availability, masks, velocity, interpolation or quality rules requires a new preprocessing identity. No unknown-version migration is performed.

## Feature layout

Zero-based offsets; row-major `[64,170]`:

| Slots | Values |
|---|---|
| 0–62 | Anatomical left hand, landmarks 0..20, XYZ |
| 63–125 | Anatomical right hand, landmarks 0..20, XYZ |
| 126–127 | Left wrist body-relative XY |
| 128–129 | Right wrist body-relative XY |
| 130–141 | Pose 11,12,13,14,15,16, XY |
| 142–153 | Face 1,33,263,13,14,152, XY |
| 154–155 | Left wrist velocity XY per second |
| 156–157 | Right wrist velocity XY per second |
| 158–159 | Left/right hand masks |
| 160–165 | Selected pose point masks in the same order |
| 166 | Face subset mask |
| 167–168 | Left/right velocity masks |
| 169 | Whole-turn duration seconds / 10 |

`schema.ts` exports named offsets, widths, versions and JSON-serializable policies. Tests require each of the 170 slots exactly once.

## Spatial equations and availability

Pixel coordinates are `X=x*sourceWidth`, `Y=y*sourceHeight`. Body origin is the midpoint of shoulders 11/12; body scale is their pixel XY distance. Both shoulders require an explicitly present visibility >=0.5 and scale >=10% of the shorter image edge. Each selected pose point additionally needs visibility >=0.5. Absent visibility is invalid. Body-relative XY is `(pixel-origin)/bodyScale`.

Each hand uses its own wrist 0 as origin. Scale is the median of the four pixel XY distances to MCP 5/9/13/17 (average the two middle distances), at least 1.5% of the shorter image edge. Hand-local XY is wrist-relative pixel XY divided by that scale. Hand Z is `(point.z-wrist.z)*sourceWidth/handScale`. World coordinates are validated but never used as features. The face subset is all-or-none: its six positions require the complete source face topology and valid body anchors; no invented face visibility score is used.

Missing components are zero with masks zero. Hand-local availability does not require body anchors. Body-relative wrist coordinates require the corresponding hand and valid body anchors, and otherwise are zero. The existing 11-mask budget encodes this dependency: wrist-position availability is `handMask AND pose11Mask AND pose12Mask`. Internal wrist availability is also retained explicitly for velocity calculations. A hand coordinate origin legitimately equals zero while its mask remains one.

No mirroring, rotating, swapping, world-depth substitution, rest trimming, scale fitting or linguistic assumptions are applied. Unmirrored source coordinates and anatomical labels retain Scope 4 semantics.

## Temporal and quality policy

Validate strictly increasing media timestamps and sequence numbers, one run, stable positive source dimensions and finite data. Duration is last minus first observation time, not recording frame count. Inclusive limits are 0.75 to 10 seconds. The entire observed turn is retained, including rest.

Normalize each source observation first. Sample exactly 64 uniform positions across the first and last times (both included). Exact observations retain their available components. Between observations, linearly interpolate each normalized component only if both adjacent endpoints are valid and their gap is <=250 ms. No extrapolation, look-through of missing observations or long-gap bridging is allowed. Masks stay binary. Normalizing before interpolation is part of the versioned contract.

Velocities are backward differences after resampling, in body-normalized units per actual elapsed second. First timestep is zero with mask zero. Both resampled wrist endpoints must be available; every intersected source interval must also support that wrist. This additional continuity check prevents a coarse grid from hiding an intermediate missing wrist. Unsupported velocity stays zero/mask0.

Coverage is supported adjacent interval duration divided by the full turn duration. A component supports an interval only when valid at both ends and the interval is <=250 ms. Any-hand coverage is the union of intervals supported by left or right; a lone left observation followed by a lone right observation supports neither hand across that interval. Isolated valid endpoints have zero duration measure. Pose coverage is the mean of the six selected point coverages; per-point metrics are also reported. Original observation absence counts are separate metrics.

PASS requires body anchors >=85%, any usable hand >=70%, and duration within limits. These are generic engineering gates, without class-specific two-hand or face requirements. Missing intervals can cause FAIL even when all 64 sampled grid positions appear available. Thresholds are not tuned to this dataset. No dataset-wide normalization or learned transform exists.

## Validation and future consumers

`npm --prefix tools/sign-data run test:preprocessing`

`node node_modules/typescript/bin/tsc -p shared/sign-preprocessing/tsconfig.json`

Golden tests use synthetic coordinates with known equations; they require no dataset or device. The standalone typecheck has no ambient DOM/Node types. Future browser code imports this same `preprocessSequence` entry point and must use this version with its eventual trained model. Browser integration, classifier tensors beyond this contract, model training, ONNX and recognition UI are outside this phase.

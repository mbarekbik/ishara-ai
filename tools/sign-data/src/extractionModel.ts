import assert from "node:assert/strict";
import type { BodyLandmarks, ImageLandmark, LandmarkFrame } from "../../../apps/web/src/features/sign/tracking/model.ts";
import { SMOKE_CLASSES, validateSourceReference, VOCABULARY_ID } from "./curation.ts";
import { ordinal, sha256 } from "./sourceFiles.ts";

export type { LandmarkFrame } from "../../../apps/web/src/features/sign/tracking/model.ts";

export interface ExtractionSample {
  sampleId: string;
  classId: string;
  classIndex: number;
  sourceCsv: string;
  sourceRow: number;
  category: string;
  metadataFilePath: string;
  metadataFilename: string;
  localVideoRelativePath: string;
  rawSourceLabel: string;
  sourceEnglishGloss: string | null;
  declaredSignerId: string;
  identityStatus: "DECLARED_ONLY_UNVERIFIED";
  sha256: string;
  duration: number;
  frameRate: number;
  frameCount: number;
  resolution: { width: number; height: number };
  fileSizeBytes: number;
  auditMatchStatus: "EXACT" | "UNICODE_EQUIVALENT" | "DETERMINISTIC_NONEXACT";
  auditMatchReason: string;
  duplicateGroupId: string | null;
  contentProvenance: { sourceCsv: string; sourceRow: number; localVideoRelativePath: string; rawSourceLabel: string }[];
  eligibility: "ELIGIBLE_ENGINEERING_ONLY";
  exclusionReason: null;
  exclusionReasons: [];
  duplicateOfSampleId: null;
  readabilityEvidence: "prior-full-decode-with-identical-source-hashes";
  linguisticReviewStatus: "unverified";
  auditReviewReasons: string[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `Invalid ${label}`);
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, label: string): asserts value is string {
  assert(typeof value === "string" && value.length > 0, `Invalid ${label}`);
}
function finite(value: unknown, label: string): asserts value is number {
  assert(typeof value === "number" && Number.isFinite(value), `Nonfinite ${label}`);
}
function positive(value: unknown, label: string, integer = false): asserts value is number {
  finite(value, label);
  assert(value > 0 && (!integer || Number.isSafeInteger(value)), `Invalid ${label}`);
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  assert(required.every(key => Object.hasOwn(value, key)), "Missing LandmarkFrame property");
  assert(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "Unexpected LandmarkFrame property");
}
const sampleIdPattern = /^mosl-smoke5-v1:[0-9a-f]{64}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

/** IDs remain unchanged in manifests. Percent encoding only makes their file names valid on Windows. */
export function sampleOutputPath(sampleId: string): string {
  assert(sampleIdPattern.test(sampleId), "Unsafe or unsupported extraction sample ID");
  return `samples/${encodeURIComponent(sampleId)}.jsonl`;
}

/** Read the frozen curation only; source discovery and filename association are deliberately absent. */
export function parseExtractionInputs(vocabularyText: string, samplesText: string, coverageText: string): ExtractionSample[] {
  const vocabulary = object(JSON.parse(vocabularyText), "vocabulary");
  const coverage = object(JSON.parse(coverageText), "coverage");
  assert.equal(vocabulary.schemaVersion, 1);
  assert.equal(vocabulary.vocabularyId, VOCABULARY_ID);
  assert.equal(vocabulary.purpose, "ENGINEERING_SMOKE_TEST_ONLY");
  assert(Array.isArray(vocabulary.classes) && vocabulary.classes.length === 5, "Expected exactly five frozen classes");
  for (const [index, value] of vocabulary.classes.entries()) {
    const definition = object(value, "class");
    const expected = SMOKE_CLASSES[index];
    assert.equal(definition.classIndex, expected.classIndex, "Frozen class ordering differs");
    assert.equal(definition.classId, expected.classId, "Frozen class ID differs");
    assert.equal(definition.rawSourceLabel, expected.rawSourceLabel, "Exact raw source label differs");
    assert.equal(definition.displayAr, expected.rawSourceLabel);
    assert.equal(definition.linguisticReviewStatus, "unverified");
    assert.equal(definition.enabledForEngineeringSmokeTest, true);
  }
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.vocabularyId, VOCABULARY_ID);
  assert.equal(coverage.status, "READY_FOR_OFFLINE_LANDMARK_EXTRACTION_ENGINEERING_ONLY");
  for (const key of ["metadataRowCount", "candidateRecordCount", "totalUsableUniqueSamples"]) assert.equal(coverage[key], 21, "Expected exactly 21 curated source samples");
  for (const key of ["totalExcludedCandidates", "totalExcludedDuplicates", "totalTechnicalExclusions"]) assert.equal(coverage[key], 0, "Frozen curation contains exclusions");
  assert.equal(coverage.signerIndependentEvaluationPermitted, false);
  assert.equal(coverage.splitsCreated, false);
  const hashes = object(coverage.artifactSHA256, "curation artifact hashes");
  assert.equal(hashes["vocabulary.json"], sha256(vocabularyText), "Curation vocabulary SHA-256 mismatch");
  assert.equal(hashes["samples.jsonl"], sha256(samplesText), "Curation samples SHA-256 mismatch");
  assert(samplesText.endsWith("\n") && !samplesText.startsWith("\uFEFF"), "Samples require UTF-8 JSONL with final LF and no BOM");
  const lines = samplesText.slice(0, -1).split("\n");
  assert.equal(lines.length, 21, "Expected exactly 21 sample records");
  const samples = lines.map((line, index) => {
    const value = object(JSON.parse(line), `sample ${index + 1}`);
    for (const key of ["sampleId", "classId", "sourceCsv", "category", "metadataFilePath", "metadataFilename", "localVideoRelativePath", "rawSourceLabel", "declaredSignerId", "sha256", "auditMatchReason"] as const) nonempty(value[key], key);
    const sample = value as unknown as ExtractionSample;
    assert(Number.isSafeInteger(sample.classIndex), "Invalid class index");
    const definition = SMOKE_CLASSES[sample.classIndex];
    assert(definition && definition.classId === sample.classId && definition.rawSourceLabel === sample.rawSourceLabel, "Sample class or exact raw source label differs");
    assert(!/^\p{M}+$/u.test(sample.rawSourceLabel), "Suspicious combining-mark-only label");
    positive(sample.sourceRow, "physical source row", true);
    assert(sample.sourceRow >= 2, "Source row must follow CSV header");
    validateSourceReference(sample.sourceCsv, "metadata");
    validateSourceReference(sample.localVideoRelativePath, "videos");
    assert(digestPattern.test(sample.sha256), "Invalid sample SHA-256");
    assert.equal(sample.sampleId, `${VOCABULARY_ID}:${sha256(JSON.stringify([VOCABULARY_ID, sample.sourceCsv, sample.sourceRow, sample.localVideoRelativePath]))}`, "Source sample identity differs");
    sampleOutputPath(sample.sampleId);
    assert.equal(sample.eligibility, "ELIGIBLE_ENGINEERING_ONLY", "Excluded sample cannot be extracted");
    assert(["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT"].includes(sample.auditMatchStatus), "Ambiguous/unaccepted mapping cannot be extracted");
    assert.equal(sample.exclusionReason, null);
    assert.deepEqual(sample.exclusionReasons, []);
    assert.equal(sample.duplicateOfSampleId, null, "Duplicate is not an independent sample");
    assert(sample.duplicateGroupId === null || sample.duplicateGroupId === `sha256:${sample.sha256}`, "Invalid duplicate group");
    assert.equal(sample.linguisticReviewStatus, "unverified");
    assert.equal(sample.identityStatus, "DECLARED_ONLY_UNVERIFIED");
    assert.equal(sample.readabilityEvidence, "prior-full-decode-with-identical-source-hashes");
    assert(sample.sourceEnglishGloss === null || typeof sample.sourceEnglishGloss === "string");
    assert(Array.isArray(sample.auditReviewReasons) && sample.auditReviewReasons.every(reason => typeof reason === "string"));
    assert(!sample.auditReviewReasons.includes("COMBINING_MARK_ONLY_LABEL"), "Suspicious metadata cannot be extracted");
    for (const key of ["duration", "frameRate"]) positive(value[key], key);
    for (const key of ["frameCount", "fileSizeBytes"]) positive(value[key], key, true);
    const resolution = object(sample.resolution, "source resolution");
    positive(resolution.width, "width", true);
    positive(resolution.height, "height", true);
    assert(Array.isArray(sample.contentProvenance) && sample.contentProvenance.length > 0, "Missing source provenance");
    for (const record of sample.contentProvenance) {
      object(record, "content provenance");
      nonempty(record.sourceCsv, "provenance CSV");
      nonempty(record.localVideoRelativePath, "provenance video");
      validateSourceReference(record.sourceCsv, "metadata");
      validateSourceReference(record.localVideoRelativePath, "videos");
      assert(Number.isSafeInteger(record.sourceRow) && record.sourceRow >= 2, "Invalid provenance row");
      assert.equal(record.rawSourceLabel, sample.rawSourceLabel, "Content associated with another label needs review");
    }
    assert(sample.contentProvenance.some(record => record.sourceCsv === sample.sourceCsv && record.sourceRow === sample.sourceRow && record.localVideoRelativePath === sample.localVideoRelativePath), "Sample missing from its content provenance");
    return sample;
  });
  for (const field of ["sampleId", "sha256", "localVideoRelativePath"] as const) assert.equal(new Set(samples.map(sample => sample[field])).size, 21, `Repeated ${field} in extraction input`);
  assert.equal(new Set(samples.map(sample => JSON.stringify([sample.sourceCsv, sample.sourceRow]))).size, 21, "Repeated source CSV row");
  assert(Array.isArray(coverage.classes) && coverage.classes.length === 5, "Invalid class coverage");
  for (const [index, definition] of SMOKE_CLASSES.entries()) {
    const members = samples.filter(sample => sample.classId === definition.classId);
    assert.equal(members.length, definition.expectedRows, `Frozen ${definition.classId} sample count differs`);
    const entry = object(coverage.classes[index], "class coverage");
    assert.equal(entry.classId, definition.classId);
    assert.equal(entry.classIndex, definition.classIndex);
    assert.equal(entry.rawSourceLabel, definition.rawSourceLabel);
    for (const key of ["metadataRowCount", "candidateRecordCount", "uniqueUsableVideoContentCount"]) assert.equal(entry[key], members.length);
    for (const key of ["excludedDuplicates", "technicalExclusions", "unresolvedMappings"]) assert.equal(entry[key], 0);
    assert.deepEqual(entry.declaredSignerIds, [...new Set(members.map(sample => sample.declaredSignerId))].sort(ordinal), "Declared signer provenance differs");
  }
  return samples.sort((a, b) => a.classIndex - b.classIndex || ordinal(a.sourceCsv, b.sourceCsv) || a.sourceRow - b.sourceRow || ordinal(a.localVideoRelativePath, b.localVideoRelativePath));
}

/** Greedy presentation-time selection. There is no frame-index-derived clock or fixed-length resampling. */
export function selectFrameTimestamps(timesMs: readonly number[], maxFps = 15): number[] {
  positive(maxFps, "maximum extraction frame rate");
  const selected: number[] = [];
  let previous = -Infinity;
  let selectedTime = -Infinity;
  for (const [index, time] of timesMs.entries()) {
    finite(time, "media timestamp");
    assert(time >= 0 && time > previous, "Media timestamps must be nonnegative and strictly increasing");
    previous = time;
    if (!selected.length || time >= selectedTime + 1000 / maxFps) {
      selected.push(index);
      selectedTime = time;
    }
  }
  return selected;
}

export interface ExpectedLandmarkFrame {
  trackingRunId: string;
  sequence: number;
  timestampMs: number;
  width: number;
  height: number;
}

function validatePoints(value: unknown, count: number): ImageLandmark[] {
  assert(Array.isArray(value) && value.length === count, `Invalid landmark topology: expected ${count} points`);
  return Array.from(value, item => {
    const point = object(item, "landmark point");
    exactKeys(point, ["x", "y", "z"], ["visibility"]);
    finite(point.x, "landmark x"); finite(point.y, "landmark y"); finite(point.z, "landmark z");
    if (point.visibility !== undefined) {
      finite(point.visibility, "landmark visibility");
      assert(point.visibility >= 0 && point.visibility <= 1, "Invalid visibility range");
    }
    // Preserve finite out-of-frame coordinates, component-relative z and optional visibility exactly.
    return { x: point.x, y: point.y, z: point.z, ...(point.visibility !== undefined ? { visibility: point.visibility } : {}) };
  });
}
function validateBody(value: unknown, count: number): BodyLandmarks | null {
  if (value === null) return null;
  const body = object(value, "body landmarks");
  exactKeys(body, ["image"], ["world"]);
  const image = validatePoints(body.image, count);
  if (body.world === undefined) return { image };
  const world = object(body.world, "world landmarks");
  exactKeys(world, ["space", "points"]);
  assert.equal(world.space, "pose-hips-meters");
  return { image, world: { space: "pose-hips-meters", points: validatePoints(world.points, count) } };
}

/** Verify and serialize the existing domain contract; this does not normalize, mirror or manufacture geometry. */
export function validateLandmarkFrame(value: unknown, expected: ExpectedLandmarkFrame): LandmarkFrame {
  const frame = object(value, "LandmarkFrame");
  exactKeys(frame, ["schemaVersion", "topology", "trackingRunId", "sequence", "timestampMs", "source", "pose", "leftHand", "rightHand", "face"]);
  assert.equal(frame.schemaVersion, 1);
  assert.equal(frame.topology, "human-553-v1");
  nonempty(expected.trackingRunId, "tracking run ID");
  assert(Number.isSafeInteger(expected.sequence) && expected.sequence >= 0, "Invalid sequence");
  finite(expected.timestampMs, "expected media timestamp");
  assert(expected.timestampMs >= 0, "Negative media timestamp");
  positive(expected.width, "source width", true); positive(expected.height, "source height", true);
  assert.equal(frame.trackingRunId, expected.trackingRunId, "Unexpected tracking run");
  assert.equal(frame.sequence, expected.sequence, "Unexpected frame sequence");
  assert.equal(frame.timestampMs, expected.timestampMs, "Unexpected media timestamp");
  const source = object(frame.source, "source geometry");
  exactKeys(source, ["width", "height", "mirrored"]);
  assert.equal(source.width, expected.width); assert.equal(source.height, expected.height);
  assert.equal(source.mirrored, false, "Mirrored domain coordinates are forbidden");
  let face: LandmarkFrame["face"] = null;
  if (frame.face !== null) {
    const value = object(frame.face, "face landmarks");
    exactKeys(value, ["image"]);
    face = { image: validatePoints(value.image, 478) };
  }
  return {
    schemaVersion: 1, topology: "human-553-v1", trackingRunId: expected.trackingRunId,
    sequence: expected.sequence, timestampMs: expected.timestampMs,
    source: { width: expected.width, height: expected.height, mirrored: false },
    pose: validateBody(frame.pose, 33), leftHand: validateBody(frame.leftHand, 21),
    rightHand: validateBody(frame.rightHand, 21), face,
  };
}

export function serializeLandmarkFrame(frame: LandmarkFrame): string {
  const checked = validateLandmarkFrame(frame, {
    trackingRunId: frame.trackingRunId, sequence: frame.sequence, timestampMs: frame.timestampMs,
    width: frame.source.width, height: frame.source.height,
  });
  return JSON.stringify(checked) + "\n";
}

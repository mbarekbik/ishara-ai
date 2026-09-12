import assert from "node:assert/strict";
import test from "node:test";
import { SMOKE_CLASSES, VOCABULARY_ID } from "./curation.ts";
import { sha256 } from "./sourceFiles.ts";
import { sampleOutputPath } from "./extractionModel.ts";
import type { ExtractionSample } from "./extractionModel.ts";
import { assertSourceHash, buildExtractionManifest, readDetectorOptions } from "./extractionFiles.ts";
import type { ExtractionResult } from "./extractionFiles.ts";

type ManifestInput = Parameters<typeof buildExtractionManifest>[0];

function fixture(): ManifestInput {
  let row = 1;
  const samples: ExtractionSample[] = SMOKE_CLASSES.flatMap(definition => Array.from({ length: definition.expectedRows }, (_, index) => {
    row++;
    const sourceCsv = "metadata/synthetic.csv";
    const filename = `${definition.rawSourceLabel} (${index + 1}).mp4`;
    const localVideoRelativePath = `videos/synthetic/${filename}`;
    return {
      sampleId: `${VOCABULARY_ID}:${sha256(JSON.stringify([VOCABULARY_ID, sourceCsv, row, localVideoRelativePath]))}`,
      classId: definition.classId, classIndex: definition.classIndex, sourceCsv, sourceRow: row,
      category: "synthetic", metadataFilePath: `/content/drive/${filename}`, metadataFilename: filename,
      localVideoRelativePath, rawSourceLabel: definition.rawSourceLabel, sourceEnglishGloss: definition.displayEn,
      declaredSignerId: `signer_${definition.classIndex + 1}`, identityStatus: "DECLARED_ONLY_UNVERIFIED",
      sha256: sha256(`synthetic-video-${row}`), duration: 0.2, frameRate: 25, frameCount: 5,
      resolution: { width: 460, height: 460 }, fileSizeBytes: 1000, auditMatchStatus: "EXACT",
      auditMatchReason: "Synthetic fixture", duplicateGroupId: null,
      contentProvenance: [{ sourceCsv, sourceRow: row, localVideoRelativePath, rawSourceLabel: definition.rawSourceLabel }],
      eligibility: "ELIGIBLE_ENGINEERING_ONLY", exclusionReason: null, exclusionReasons: [], duplicateOfSampleId: null,
      readabilityEvidence: "prior-full-decode-with-identical-source-hashes", linguisticReviewStatus: "unverified", auditReviewReasons: [],
    };
  }));
  const results: ExtractionResult[] = samples.map(sample => ({
    sampleId: sample.sampleId, classId: sample.classId, classIndex: sample.classIndex, rawSourceLabel: sample.rawSourceLabel,
    sourceCsv: sample.sourceCsv, sourceRow: sample.sourceRow, declaredSignerId: sample.declaredSignerId,
    sourceVideoRelativePath: sample.localVideoRelativePath, sourceVideoSHA256: sample.sha256, sourceDurationSeconds: sample.duration,
    status: "success", delegate: "GPU", decodedSourceFrameCount: 5,
    selectedSourceFrames: [{ index: 0, timestampMs: 0 }, { index: 2, timestampMs: 80 }, { index: 4, timestampMs: 160 }],
    sourceDimensions: { ...sample.resolution }, sourceTimeBase: "1/12800", mediaStartMs: 0, mediaEndMs: 200,
    extractedLandmarkFrameCount: 3, firstMediaTimestampMs: 0, lastMediaTimestampMs: 160,
    outputRelativePath: sampleOutputPath(sample.sampleId), outputSHA256: sha256(`synthetic-output-${sample.sampleId}`),
    coverage: { frames: 3, leftHand: 3, rightHand: 1, pose: 3, face: 2 }, warnings: [], error: null,
    inferenceMilliseconds: { total: 300, maximum: 110 },
  }));
  return {
    inputs: { samples, curationSHA256: { "vocabulary.json": "a".repeat(64), "samples.jsonl": "b".repeat(64), "coverage.json": "c".repeat(64) } },
    vision: {
      mediapipeVersion: "1.0.1", model: { productionRelativePath: "apps/web/public/models/holistic-landmarker/float16/1/holistic_landmarker.task", sha256: "d".repeat(64), bytes: 13683609 },
      wasmRuntimeVersion: "1.0.1", wasm: { "vision_wasm_module_internal.wasm": { sha256: "e".repeat(64), size: 1000 } },
      reusedSources: { "apps/web/src/features/sign/tracking/model.ts": "f".repeat(64) },
      detectorOptions: { runningMode: "VIDEO", outputFaceBlendshapes: false }, maxImageLongEdge: 960, resizeQuality: "low", mirrored: false,
    },
    browserVersion: "Synthetic Chromium", runtimeInfo: { platform: "synthetic" }, mediaTools: { ffmpeg: "synthetic", ffprobe: "synthetic" },
    extractionTimestamp: "2026-09-12T00:00:00.000Z", delegate: "GPU", results,
  };
}

test("source verification requires both curated SHA-256 and byte-size without mutating inputs", () => {
  const sample = fixture().inputs.samples[0];
  const original = JSON.stringify(sample);
  assert.doesNotThrow(() => assertSourceHash(sample, { sha256: sample.sha256, size: sample.fileSizeBytes }));
  assert.throws(() => assertSourceHash(sample, { sha256: "0".repeat(64), size: sample.fileSizeBytes }), /Source SHA-256 mismatch/u);
  assert.throws(() => assertSourceHash(sample, { sha256: sample.sha256, size: sample.fileSizeBytes + 1 }), /Source byte-size mismatch/u);
  assert.equal(JSON.stringify(sample), original);
});

test("detector provenance reads exact scalar values from the existing construction shape without evaluating code", () => {
  const source = `detector = await HolisticLandmarker.createFromOptions(assets, {
    baseOptions: { modelAssetPath: localModel, delegate }, canvas,
    runningMode: "VIDEO", minFaceDetectionConfidence: 0.5,
    minPoseDetectionConfidence: 0.25, minHandLandmarksConfidence: 0.75,
    outputFaceBlendshapes: false, outputPoseSegmentationMasks: true
  });`;
  assert.deepEqual(readDetectorOptions(source), {
    runningMode: "VIDEO", minFaceDetectionConfidence: 0.5, minPoseDetectionConfidence: 0.25,
    minHandLandmarksConfidence: 0.75, outputFaceBlendshapes: false, outputPoseSegmentationMasks: true,
  });
});

test("missing, dynamic, unexpected and multiple detector configurations require explicit review", () => {
  for (const source of [
    "const detector = null;",
    "task.createFromOptions(assets, options);",
    "task.createFromOptions(assets, {runningMode: computeMode()});",
    "task.createFromOptions(assets, {runningMode: 'VIDEO', minFaceDetectionConfidence: threshold});",
    "task.createFromOptions(assets, {runningMode: 'VIDEO', ...additionalOptions});",
    "task.createFromOptions(assets, {runningMode: 'IMAGE'});",
    "task.createFromOptions(assets, {runningMode: 'VIDEO'}); task.createFromOptions(assets, {runningMode: 'VIDEO'});",
  ]) assert.throws(() => readDetectorOptions(source));
});

test("manifest preserves frozen provenance and deterministically reports 21 successful samples and anatomy coverage", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const manifest = buildExtractionManifest(input);
  assert.equal(manifest.sourceSampleCount, 21);
  assert.equal(manifest.classCount, 5);
  assert.equal(manifest.successfulExtractions, 21);
  assert.equal(manifest.failedExtractions, 0);
  assert.equal(manifest.pendingExtractions, 0);
  assert.equal(manifest.totalLandmarkFrameCount, 63);
  assert.deepEqual(manifest.trackingCoverage, { frames: 63, leftHand: 63, rightHand: 21, pose: 63, face: 42 });
  assert.equal(manifest.delegate, "GPU");
  assert.equal(manifest.status, "COMPLETE");
  assert.equal(manifest.purpose, "ENGINEERING_RAW_TRACKING_SEQUENCES_ONLY");
  assert.equal(manifest.linguisticReviewStatus, "unverified");
  assert.equal(manifest.vision.model.sha256, input.vision.model.sha256);
  assert.deepEqual(manifest.curationSHA256, input.inputs.curationSHA256);
  assert.deepEqual(manifest.samples.map(sample => sample.sampleId), input.inputs.samples.map(sample => sample.sampleId));
  assert.deepEqual(buildExtractionManifest(structuredClone(input)), manifest);
  assert.equal(JSON.stringify(input), before, "Manifest generation cannot mutate source references");
});

test("partial/failed extraction retains diagnostic results and cannot claim completion", () => {
  const input = fixture();
  input.results = input.results.slice(0, 2);
  Object.assign(input.results[1], {
    status: "failed", delegate: null, extractedLandmarkFrameCount: 0,
    firstMediaTimestampMs: null, lastMediaTimestampMs: null, outputRelativePath: null, outputSHA256: null,
    coverage: { frames: 0, leftHand: 0, rightHand: 0, pose: 0, face: 0 },
    error: { stage: "decode", message: "Synthetic decode failure" },
  });
  const manifest = buildExtractionManifest(input);
  assert.equal(manifest.successfulExtractions, 1);
  assert.equal(manifest.failedExtractions, 1);
  assert.equal(manifest.pendingExtractions, 19);
  assert.equal(manifest.totalLandmarkFrameCount, 3);
  assert.equal(manifest.status, "INCOMPLETE");
  assert.deepEqual(manifest.samples[1].error, { stage: "decode", message: "Synthetic decode failure" });
});

test("mixed successful delegates and repeated/unknown sample identities fail manifest publication", () => {
  const mixed = fixture();
  mixed.results[1].delegate = "CPU";
  assert.throws(() => buildExtractionManifest(mixed), /Mixed delegates/u);
  const repeated = fixture();
  repeated.results[1] = structuredClone(repeated.results[0]);
  assert.throws(() => buildExtractionManifest(repeated));
  for (const [field, value] of [["sampleId", "unexpected"], ["classId", "unknown-class"], ["classIndex", 99], ["sourceVideoSHA256", "0".repeat(64)]] as const) {
    const input = fixture();
    Object.assign(input.results[0], { [field]: value });
    assert.throws(() => buildExtractionManifest(input), /Unexpected source|provenance differs|source hash differs/u);
  }
});

test("manifest rejects changed source provenance even when sample ID and hash are unchanged", () => {
  for (const [field, value] of [
    ["sourceVideoRelativePath", "videos/other.mp4"], ["sourceCsv", "metadata/other.csv"], ["sourceRow", 999],
    ["rawSourceLabel", "other-label"], ["declaredSignerId", "guessed-signer"], ["sourceDurationSeconds", 20],
    ["sourceDimensions", { width: 1, height: 1 }],
  ] as const) {
    const input = fixture();
    Object.assign(input.results[0], { [field]: value });
    assert.throws(() => buildExtractionManifest(input), { name: "AssertionError" }, `Altered ${field} must fail`);
  }
});

test("manifest rejects impossible/nonfinite coverage and coverage/output-count disagreement", () => {
  for (const coverage of [
    { frames: 3, leftHand: 4, rightHand: 1, pose: 3, face: 2 },
    { frames: 3, leftHand: -1, rightHand: 1, pose: 3, face: 2 },
    { frames: 3, leftHand: 1.5, rightHand: 1, pose: 3, face: 2 },
    { frames: 3, leftHand: NaN, rightHand: 1, pose: 3, face: 2 },
    { frames: 2, leftHand: 1, rightHand: 1, pose: 2, face: 2 },
  ]) {
    const input = fixture();
    input.results[0].coverage = coverage;
    assert.throws(() => buildExtractionManifest(input));
  }
});

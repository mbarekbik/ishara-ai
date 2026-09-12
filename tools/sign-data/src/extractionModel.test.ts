import assert from "node:assert/strict";
import test from "node:test";
import type { AuditCurationRecord, CurationOutputs } from "./curation.ts";
import { buildSmokeCuration, SMOKE_CLASSES, VOCABULARY_ID } from "./curation.ts";
import { EXPECTED, sha256 } from "./sourceFiles.ts";
import { parseExtractionInputs, sampleOutputPath, selectFrameTimestamps, serializeLandmarkFrame, validateLandmarkFrame } from "./extractionModel.ts";
import type { ExpectedLandmarkFrame, LandmarkFrame } from "./extractionModel.ts";

function inputs(): CurationOutputs {
  let row = 1;
  const records: AuditCurationRecord[] = SMOKE_CLASSES.flatMap(definition => Array.from({ length: definition.expectedRows }, (_, index) => {
    row += 1;
    const filename = `${definition.rawSourceLabel} (${index + 1}).mp4`;
    return {
      sourceCsv: "metadata/synthetic.csv", sourceRow: row, category: "synthetic",
      metadataFilePath: `/content/drive/original/${filename}`, metadataFilename: filename,
      localVideoRelativePath: `videos/synthetic/${filename}`, rawSignLabel: definition.rawSourceLabel,
      englishGloss: definition.displayEn, declaredSignerId: `signer_${definition.classIndex + 1}`,
      sha256: sha256(`synthetic-video-${row}`), durationMetadata: 2, durationActual: 2,
      frameRateMetadata: 25, frameRateActual: 25, frameCountMetadata: 50, frameCountActual: 50,
      resolutionMetadata: { width: 460, height: 460 }, resolutionActual: { width: 460, height: 460 },
      fileSizeMetadata: 1000, fileSizeActual: 1000, matchStatus: "EXACT", matchReason: "Synthetic fixture",
      contentDuplicateGroupId: null, mediaComparison: { supportsAssociation: true, differences: [] },
      usableForLaterCuration: true, reviewReasons: ["DECLARED_SIGNER_ID_UNVERIFIED", "LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED"],
    };
  }));
  return buildSmokeCuration(records, {
    auditSummarySHA256: "a".repeat(64), auditInventorySHA256: "b".repeat(64), auditChecksumsSHA256: "c".repeat(64),
    videosSHA256: EXPECTED.videoDigest, videosAndCsvSHA256: EXPECTED.datasetDigest,
    sourceFilesVerified: 2221, readabilityEvidence: "prior-full-decode-with-identical-source-hashes",
  });
}
function parse(value: CurationOutputs) {
  return parseExtractionInputs(value["vocabulary.json"], value["samples.jsonl"], value["coverage.json"]);
}
function replaceSamples(value: CurationOutputs, edit: (samples: Array<Record<string, unknown>>) => void): void {
  const samples = value["samples.jsonl"].trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
  edit(samples);
  value["samples.jsonl"] = samples.map(sample => JSON.stringify(sample)).join("\n") + "\n";
  const coverage = JSON.parse(value["coverage.json"]);
  coverage.artifactSHA256["samples.jsonl"] = sha256(value["samples.jsonl"]);
  value["coverage.json"] = JSON.stringify(coverage) + "\n";
}
function replaceVocabulary(value: CurationOutputs, edit: (vocabulary: { classes: Array<Record<string, unknown>> }) => void): void {
  const vocabulary = JSON.parse(value["vocabulary.json"]);
  edit(vocabulary);
  value["vocabulary.json"] = JSON.stringify(vocabulary) + "\n";
  const coverage = JSON.parse(value["coverage.json"]);
  coverage.artifactSHA256["vocabulary.json"] = sha256(value["vocabulary.json"]);
  value["coverage.json"] = JSON.stringify(coverage) + "\n";
}

test("extraction reads exactly the frozen five classes and 21 eligible samples without changing source spelling", () => {
  const fixture = inputs();
  const before = JSON.stringify(fixture);
  const samples = parse(fixture);
  assert.equal(samples.length, 21);
  assert.deepEqual(SMOKE_CLASSES.map(definition => samples.filter(sample => sample.classId === definition.classId).length), [4, 5, 5, 3, 4]);
  assert.equal(samples[4].rawSourceLabel, "أَبٌ");
  assert.notEqual(samples[4].rawSourceLabel, samples[4].rawSourceLabel.normalize("NFC"));
  assert(samples.every(sample => sample.eligibility === "ELIGIBLE_ENGINEERING_ONLY" && sample.identityStatus === "DECLARED_ONLY_UNVERIFIED"));
  assert.equal(JSON.stringify(fixture), before, "Parsing must not modify curation input");
});

test("extraction sample order is canonical and stable under a permitted in-memory input permutation", () => {
  const fixture = inputs();
  const expected = parse(fixture);
  replaceSamples(fixture, samples => { samples.reverse(); });
  assert.deepEqual(parse(fixture), expected);
});

test("modified curation bytes fail their frozen artifact SHA-256 before extraction", () => {
  const fixture = inputs();
  fixture["samples.jsonl"] = fixture["samples.jsonl"].replace("synthetic-video", "other-video") + " ";
  assert.throws(() => parse(fixture), /Curation samples SHA-256 mismatch/u);
  const other = inputs();
  other["vocabulary.json"] += " ";
  assert.throws(() => parse(other), /Curation vocabulary SHA-256 mismatch/u);
});

test("different counts, indices and normalized Arabic cannot silently change the frozen vocabulary", () => {
  const fewer = inputs();
  replaceSamples(fewer, samples => { samples.pop(); });
  assert.throws(() => parse(fewer), /Expected exactly 21/u);
  const order = inputs();
  replaceVocabulary(order, vocabulary => { vocabulary.classes.reverse(); });
  assert.throws(() => parse(order), /Frozen class ordering differs/u);
  const spelling = inputs();
  replaceSamples(spelling, samples => { samples[4].rawSourceLabel = "أَبٌ".normalize("NFC"); });
  assert.throws(() => parse(spelling), /exact raw source label differs/u);
});

test("ambiguous, excluded, suspicious or repeated content never becomes an extraction input", () => {
  for (const [field, replacement] of [["auditMatchStatus", "AMBIGUOUS"], ["eligibility", "EXCLUDED"], ["auditReviewReasons", ["COMBINING_MARK_ONLY_LABEL"]]] as const) {
    const fixture = inputs();
    replaceSamples(fixture, samples => { samples[0][field] = replacement; });
    assert.throws(() => parse(fixture), /Ambiguous|Excluded|Suspicious/u);
  }
  const duplicate = inputs();
  replaceSamples(duplicate, samples => { samples[1].sha256 = samples[0].sha256; });
  assert.throws(() => parse(duplicate), /Repeated sha256/u);
  const unavailable = inputs();
  replaceSamples(unavailable, samples => { samples[0].frameCount = 0; });
  assert.throws(() => parse(unavailable), /Invalid frameCount/u);
});

test("unsafe source paths and forged sample IDs are rejected without filesystem access", () => {
  for (const path of ["../source.mp4", "videos/../outside.mp4", "videos/C:/outside.mp4", "videos\\sample.mp4", "/videos/outside.mp4"]) {
    const fixture = inputs();
    replaceSamples(fixture, samples => { samples[0].localVideoRelativePath = path; });
    assert.throws(() => parse(fixture), /Unsafe source reference/u);
  }
  const identity = inputs();
  replaceSamples(identity, samples => { samples[0].sampleId = `${VOCABULARY_ID}:${"0".repeat(64)}`; });
  assert.throws(() => parse(identity), /Source sample identity differs/u);
});

test("sample output paths encode identity reversibly and reject traversal, alternate streams and unknown versions", () => {
  const sampleId = `${VOCABULARY_ID}:${"a".repeat(64)}`;
  const path = sampleOutputPath(sampleId);
  assert.equal(path, `samples/mosl-smoke5-v1%3A${"a".repeat(64)}.jsonl`);
  assert.equal(decodeURIComponent(path.slice("samples/".length, -".jsonl".length)), sampleId);
  assert(!path.includes(":"));
  for (const value of ["../outside", "sample:stream", `${sampleId}/../outside`, "mosl-smoke5-v2:" + "a".repeat(64), "CON", sampleId + "\n"]) {
    assert.throws(() => sampleOutputPath(value), /Unsafe or unsupported/u);
  }
});

test("greedy extraction selection uses real media timestamps, retaining first frame without duplicates", () => {
  assert.deepEqual(selectFrameTimestamps([0, 40, 80, 120, 160, 200]), [0, 2, 4]);
  assert.deepEqual(selectFrameTimestamps([12, 32, 57, 79, 101, 150, 171, 270]), [0, 3, 5, 7]);
  assert.deepEqual(selectFrameTimestamps([0, 33.333, 66.667, 100, 133.334, 166.667, 200.001]), [0, 2, 4, 6]);
  assert.deepEqual(selectFrameTimestamps([]), []);
  assert.deepEqual(selectFrameTimestamps([700]), [0]);
  assert.deepEqual(selectFrameTimestamps([0, 100, 200], 10), [0, 1, 2]);
});

test("presentation timestamps must be finite, nonnegative and strictly chronological", () => {
  for (const times of [[0, 0], [0, 100, 90], [-1, 50], [0, NaN], [0, Infinity]]) {
    assert.throws(() => selectFrameTimestamps(times), /timestamp/u);
  }
  for (const rate of [0, -5, NaN, Infinity]) assert.throws(() => selectFrameTimestamps([0, 80], rate), /frame rate/u);
});

const expected: ExpectedLandmarkFrame = { trackingRunId: "synthetic-run", sequence: 0, timestampMs: 80, width: 640, height: 360 };
function frame(): LandmarkFrame {
  const points = (count: number, offset: number, visibility = false) => Array.from({ length: count }, (_, index) => ({
    x: index / count + offset, y: 0.25, z: -0.125, ...(visibility ? { visibility: 0.9 } : {}),
  }));
  return {
    schemaVersion: 1, topology: "human-553-v1", trackingRunId: expected.trackingRunId,
    sequence: expected.sequence, timestampMs: expected.timestampMs,
    source: { width: expected.width, height: expected.height, mirrored: false },
    pose: { image: points(33, 0, true), world: { space: "pose-hips-meters", points: points(33, -0.5, true) } },
    leftHand: { image: points(21, -0.2), world: { space: "pose-hips-meters", points: points(21, -0.4) } },
    rightHand: { image: points(21, 0.6) }, face: { image: points(478, 0) },
  };
}

test("LandmarkFrame JSONL roundtrip retains exact Scope4 topology, world space, anatomy and unmirrored finite coordinates", () => {
  const input = frame();
  const before = JSON.stringify(input);
  const line = serializeLandmarkFrame(input);
  assert(line.endsWith("\n") && line.split("\n").length === 2);
  assert.deepEqual(validateLandmarkFrame(JSON.parse(line), expected), input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.leftHand!.image[0].x, -0.2, "Out-of-frame x is preserved rather than clamped");
  assert.equal(input.rightHand!.image[0].x, 0.6, "Anatomical left/right is not swapped");
  assert.equal(input.pose!.world!.points[0].z, -0.125);
  assert(!Object.hasOwn(input.leftHand!.image[0], "visibility"), "No invented visibility");
});

test("serialized landmark property order is deterministic and absent anatomy remains explicit null", () => {
  const input = frame();
  const reversed = Object.fromEntries(Object.entries(input).reverse()) as unknown as LandmarkFrame;
  assert.equal(serializeLandmarkFrame(input), serializeLandmarkFrame(reversed));
  const empty = { ...input, pose: null, leftHand: null, rightHand: null, face: null };
  assert.deepEqual(JSON.parse(serializeLandmarkFrame(empty)), empty);
});

test("LandmarkFrame validation rejects unknown topology and nonfinite data instead of JSON null replacement", () => {
  for (const number of [NaN, Infinity, -Infinity]) {
    const invalid = JSON.parse(JSON.stringify(frame()));
    invalid.leftHand.image[0].x = number;
    assert.throws(() => serializeLandmarkFrame(invalid), /Nonfinite landmark x/u);
  }
  const count = JSON.parse(JSON.stringify(frame()));
  count.face.image.pop();
  assert.throws(() => validateLandmarkFrame(count, expected), /expected 478/u);
  const world = JSON.parse(JSON.stringify(frame()));
  world.pose.world.space = "camera-meters";
  assert.throws(() => validateLandmarkFrame(world, expected));
  const visibility = JSON.parse(JSON.stringify(frame()));
  visibility.pose.image[0].visibility = 1.1;
  assert.throws(() => validateLandmarkFrame(visibility, expected), /visibility range/u);
  const sparse = JSON.parse(JSON.stringify(frame()));
  delete sparse.leftHand.image[2];
  assert.throws(() => serializeLandmarkFrame(sparse), /Invalid landmark point/u);
});

test("LandmarkFrame validation refuses stale identity, wrong timestamps, source mismatch, mirroring and provider fields", () => {
  const input = frame();
  for (const change of [{ trackingRunId: "old-run" }, { sequence: 1 }, { timestampMs: 0 }]) {
    assert.throws(() => validateLandmarkFrame({ ...input, ...change }, expected), /Unexpected/u);
  }
  assert.throws(() => validateLandmarkFrame({ ...input, source: { ...input.source, mirrored: true } }, expected), /Mirrored/u);
  assert.throws(() => validateLandmarkFrame({ ...input, source: { ...input.source, width: 460 } }, expected));
  assert.throws(() => validateLandmarkFrame({ ...input, providerPayload: {} }, expected), /Unexpected LandmarkFrame property/u);
  assert.throws(() => validateLandmarkFrame({ ...input, leftHand: undefined }, expected), /Invalid body/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED } from "./sourceFiles.ts";
import type { AuditCurationRecord, CurationEvidence, CurationOutputs } from "./curation.ts";
import { buildSmokeCuration, parseAuditInventory, SMOKE_CLASSES, stableSampleId, validateSourceReference } from "./curation.ts";
import { validateCurationOutputs } from "./curationFiles.ts";

const evidence: CurationEvidence = {
  auditSummarySHA256: "a".repeat(64), auditInventorySHA256: "b".repeat(64), auditChecksumsSHA256: "c".repeat(64),
  videosSHA256: EXPECTED.videoDigest, videosAndCsvSHA256: EXPECTED.datasetDigest,
  sourceFilesVerified: 2221, readabilityEvidence: "prior-full-decode-with-identical-source-hashes",
};
function fixtures(): AuditCurationRecord[] {
  let sequence = 0;
  return SMOKE_CLASSES.flatMap(definition => Array.from({ length: definition.expectedRows }, (_, index) => {
    sequence += 1;
    const filename = `${definition.rawSourceLabel} (${index + 1}).mp4`;
    return {
      sourceCsv: "metadata/mosl_videos_dataset_Diverse.csv", sourceRow: sequence + 1,
      category: "mosl_videos_dataset_Diverse", metadataFilePath: `/content/drive/MyDrive/original/${filename}`,
      metadataFilename: filename, localVideoRelativePath: `videos/mosl_videos_dataset_Diverse/${filename}`,
      rawSignLabel: definition.rawSourceLabel, englishGloss: definition.displayEn, declaredSignerId: `signer_${definition.classIndex + 1}`,
      sha256: String(sequence).padStart(64, "0"),
      durationMetadata: 2, durationActual: 2, frameRateMetadata: 25, frameRateActual: 25,
      frameCountMetadata: 50, frameCountActual: 50,
      resolutionMetadata: { width: 460, height: 460 }, resolutionActual: { width: 460, height: 460 },
      fileSizeMetadata: 10000, fileSizeActual: 10000, matchStatus: "EXACT" as const,
      matchReason: "Synthetic exact raw filename mapping", contentDuplicateGroupId: null,
      mediaComparison: { supportsAssociation: true, differences: [] }, usableForLaterCuration: true,
      reviewReasons: ["DECLARED_SIGNER_ID_UNVERIFIED", "LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED"],
    };
  }));
}
function samples(outputs: CurationOutputs): Array<Record<string, unknown>> {
  return outputs["samples.jsonl"].trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
}

test("five exact classes preserve user order, Arabic composition, provenance and engineering-only scope", () => {
  const records = fixtures();
  const output = buildSmokeCuration(records, evidence);
  const vocabulary = JSON.parse(output["vocabulary.json"]) as { purpose: string; classes: Array<{ classIndex: number; classId: string; rawSourceLabel: string; displayAr: string; linguisticReviewStatus: string }> };
  const labels = ["صَبَاحُ الْخَيْرِ", "أَبٌ", "سُوقٌ", "هَدِيَّةٌ", "شُرْطِيٌّ"];
  assert.deepEqual(vocabulary.classes.map(entry => entry.rawSourceLabel), labels);
  assert.deepEqual(vocabulary.classes.map(entry => entry.classId), ["good_morning", "father", "market", "gift", "police_officer"]);
  assert.deepEqual(vocabulary.classes.map(entry => entry.classIndex), [0, 1, 2, 3, 4]);
  assert(vocabulary.classes.every(entry => entry.displayAr === entry.rawSourceLabel && entry.linguisticReviewStatus === "unverified"));
  assert.equal(vocabulary.purpose, "ENGINEERING_SMOKE_TEST_ONLY");
  const outputSamples = samples(output);
  assert.equal(outputSamples.length, 21);
  assert.equal(new Set(outputSamples.map(sample => sample.sampleId)).size, 21);
  assert(outputSamples.every(sample => sample.eligibility === "ELIGIBLE_ENGINEERING_ONLY" && sample.identityStatus === "DECLARED_ONLY_UNVERIFIED"));
  assert.deepEqual(outputSamples.map(sample => sample.rawSourceLabel), records.map(record => record.rawSignLabel));
  assert.deepEqual(outputSamples.map(sample => sample.localVideoRelativePath), records.map(record => record.localVideoRelativePath));
  const coverage = JSON.parse(output["coverage.json"]);
  assert.equal(coverage.totalUsableUniqueSamples, 21);
  assert.equal(coverage.signerIndependentEvaluationPermitted, false);
  assert.equal(coverage.splitsCreated, false);
  validateCurationOutputs(output);
});

test("curation outputs and sample identities are deterministic under input reversal", () => {
  const records = fixtures();
  const before = JSON.stringify(records);
  assert.deepEqual(buildSmokeCuration(records, evidence), buildSmokeCuration([...records].reverse(), evidence));
  assert.equal(stableSampleId(records[0]), stableSampleId(structuredClone(records[0])));
  assert.notEqual(stableSampleId(records[0]), stableSampleId({ ...records[0], sourceRow: 999 }));
  assert.equal(JSON.stringify(records), before, "Curation must not mutate audit records");
});

test("NFC-equivalent source label is not silently substituted for the exact selected label", () => {
  const records = fixtures();
  const father = records.find(record => record.rawSignLabel === "أَبٌ")!;
  assert.notEqual(father.rawSignLabel, father.rawSignLabel.normalize("NFC"));
  father.rawSignLabel = father.rawSignLabel.normalize("NFC");
  assert.throws(() => buildSmokeCuration(records, evidence), /father exact raw-label row count differs/u);
});

test("wrong class coverage and duplicate candidate rows stop rather than invent samples", () => {
  const records = fixtures();
  assert.throws(() => buildSmokeCuration(records.slice(1), evidence), /good_morning exact raw-label row count differs/u);
  assert.throws(() => buildSmokeCuration([...records, structuredClone(records[0])], evidence), /Duplicate inventory candidate/u);
  assert.throws(() => buildSmokeCuration(records, { ...evidence, videosSHA256: "0".repeat(64) }), /Known video digest/u);
  assert.throws(() => buildSmokeCuration(records, { ...evidence, sourceFilesVerified: 21 }), /Whole-source checksum verification/u);
});

test("within-class duplicate content preserves all references but counts only the deterministic first copy", () => {
  const records = fixtures();
  records[1].sha256 = records[0].sha256;
  const output = buildSmokeCuration(records, evidence);
  assert.deepEqual(output, buildSmokeCuration([...records].reverse(), evidence));
  const first = samples(output).find(sample => sample.sourceRow === records[0].sourceRow)!;
  const duplicate = samples(output).find(sample => sample.sourceRow === records[1].sourceRow)!;
  assert.equal(first.eligibility, "ELIGIBLE_ENGINEERING_ONLY");
  assert.equal(duplicate.eligibility, "EXCLUDED");
  assert.equal(duplicate.exclusionReason, "DUPLICATE_CONTENT");
  assert.equal(duplicate.duplicateOfSampleId, first.sampleId);
  assert.equal((first.contentProvenance as unknown[]).length, 2);
  assert.equal((duplicate.contentProvenance as unknown[]).length, 2);
  assert.equal(JSON.parse(output["coverage.json"]).totalUsableUniqueSamples, 20);
  assert.equal(JSON.parse(output["exclusions.json"]).excludedCandidateCount, 1);
  validateCurationOutputs(output);
});

test("identical content shared by selected labels is withheld without merging those classes", () => {
  const records = fixtures();
  const father = records.find(record => record.rawSignLabel === "أَبٌ")!;
  father.sha256 = records[0].sha256;
  const output = buildSmokeCuration(records, evidence);
  const shared = samples(output).filter(sample => sample.sha256 === father.sha256);
  assert.equal(shared.length, 2);
  assert(shared.every(sample => sample.eligibility === "EXCLUDED" && sample.exclusionReason === "CONTENT_SHARED_WITH_OTHER_LABEL"));
  assert.equal(new Set(shared.map(sample => sample.classId)).size, 2);
  assert.equal(JSON.parse(output["coverage.json"]).totalUsableUniqueSamples, 19);
});

test("content shared with an unselected raw label also requires review", () => {
  const records = fixtures();
  const extra = { ...structuredClone(records[0]), sourceRow: 999, rawSignLabel: "unselected exact label", localVideoRelativePath: "videos/mosl_videos_dataset_Diverse/other.mp4", metadataFilename: "other.mp4" };
  const output = buildSmokeCuration([...records, extra], evidence);
  assert.equal(samples(output).length, 21);
  const selected = samples(output).find(sample => sample.sourceRow === records[0].sourceRow)!;
  assert.equal(selected.exclusionReason, "CONTENT_SHARED_WITH_OTHER_LABEL");
  assert.equal((selected.contentProvenance as unknown[]).length, 2);
});

test("invalid media, ambiguous mapping and suspicious audit metadata remain explicit exclusions", () => {
  const records = fixtures();
  records[0].durationActual = null;
  records[4].matchStatus = "AMBIGUOUS";
  records[9].reviewReasons.push("COMBINING_MARK_ONLY_LABEL");
  const output = buildSmokeCuration(records, evidence);
  const byRow = new Map(samples(output).map(sample => [sample.sourceRow, sample]));
  assert.equal(byRow.get(records[0].sourceRow)?.exclusionReason, "INVALID_MEDIA_OR_METADATA");
  assert.equal(byRow.get(records[4].sourceRow)?.exclusionReason, "MAPPING_NOT_ACCEPTED");
  assert.equal(byRow.get(records[9].sourceRow)?.exclusionReason, "SUSPICIOUS_METADATA");
  assert.equal(JSON.parse(output["coverage.json"]).totalTechnicalExclusions, 3);
  assert.equal(JSON.parse(output["coverage.json"]).totalUsableUniqueSamples, 18);
});

test("fewer than two eligible unique recordings in any class blocks the engineering manifest", () => {
  const records = fixtures();
  const gifts = records.filter(record => record.rawSignLabel === "هَدِيَّةٌ");
  gifts[0].frameCountActual = null;
  gifts[1].usableForLaterCuration = false;
  assert.throws(() => buildSmokeCuration(records, evidence), /at least two unique eligible recordings: gift/u);
});

test("positive media mismatches cannot bypass the reused audit tolerance policy", () => {
  for (const field of ["frameCountActual", "fileSizeActual", "durationActual", "frameRateActual"] as const) {
    const records = fixtures();
    records[0][field]! += 10;
    const first = samples(buildSmokeCuration(records, evidence))[0];
    assert.equal(first.exclusionReason, "INVALID_MEDIA_OR_METADATA");
  }
  const records = fixtures();
  records[0].resolutionActual.width = 461;
  assert.equal(samples(buildSmokeCuration(records, evidence))[0].exclusionReason, "INVALID_MEDIA_OR_METADATA");
});

test("source-reference validator rejects traversal, alternate streams, wrong roots and extensions", () => {
  for (const value of ["videos/../outside.mp4", "videos/./a.mp4", "videos//a.mp4", "videos/a.mp4:stream", "videos/a\\b.mp4", "videos/\u0000a.mp4", "C:/videos/a.mp4", "metadata/a.mp4", "videos/a.csv"]) {
    assert.throws(() => validateSourceReference(value, "videos"));
  }
  assert.doesNotThrow(() => validateSourceReference("videos/متنوع/أَبٌ (1).mp4", "videos"));
  assert.doesNotThrow(() => validateSourceReference("metadata/a.csv", "metadata"));
});

test("persisted audit parser validates row schemas and preserves exact source values", () => {
  const record = fixtures()[0];
  const serialize = (value: unknown) => `${JSON.stringify(value)}\n`;
  assert.deepEqual(parseAuditInventory(serialize(record)), [record]);
  for (const bad of [
    JSON.stringify(record), "not JSON\n", "null\n", "[]\n",
    serialize({ ...record, sourceRow: 1 }),
    serialize({ ...record, sha256: "missing" }),
    serialize({ ...record, contentDuplicateGroupId: "sha256:not-the-same" }),
    serialize({ ...record, matchStatus: "GUESSED" }),
    serialize({ ...record, durationActual: "2" }),
    serialize({ ...record, resolutionActual: null }),
    serialize({ ...record, localVideoRelativePath: "videos/../outside.mp4" }),
  ]) assert.throws(() => parseAuditInventory(bad));
});

test("artifact verification rejects changed class order, altered samples, and incomplete output", () => {
  const output = buildSmokeCuration(fixtures(), evidence);
  const vocabulary = JSON.parse(output["vocabulary.json"]);
  vocabulary.classes.reverse();
  assert.throws(() => validateCurationOutputs({ ...output, "vocabulary.json": JSON.stringify(vocabulary) + "\n" }));
  assert.throws(() => validateCurationOutputs({ ...output, "samples.jsonl": output["samples.jsonl"].replace('"ELIGIBLE_ENGINEERING_ONLY"', '"EXCLUDED"') }));
  assert.throws(() => validateCurationOutputs({ ...output, "review.md": "changed\n" }), /hash mismatch/u);
  assert.throws(() => validateCurationOutputs({ ...output, "exclusions.json": "" }));
});

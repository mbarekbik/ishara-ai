import assert from "node:assert/strict";
import { basename } from "node:path";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { OUTPUT_NAMES } from "./auditPackage.ts";
import type { AuditOutputs } from "./auditPackage.ts";
import { parseMetadataCsv } from "./mapping.ts";
import { validateAuditPackage } from "./validation.ts";
import { assertNoLinks, boundedPath, collectSourceFiles, EXPECTED, OUTPUT_ROOT, REPOSITORY_ROOT, sha256, SOURCE_ROOT, verifyBaseline } from "./sourceFiles.ts";
import { buildSmokeCuration, CURATION_OUTPUT_NAMES, parseAuditInventory, SMOKE_CLASSES } from "./curation.ts";
import type { CurationEvidence, CurationOutputs } from "./curation.ts";

export const CURATION_ROOT = boundedPath(REPOSITORY_ROOT, "data/scope5/curation/mosl-v1/smoke5-v1");
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
async function readBounded(root: string, name: string): Promise<string> {
  const path = boundedPath(root, name);
  await assertNoLinks(REPOSITORY_ROOT, path);
  return utf8.decode(await readFile(path));
}

/** Reuse audit evidence: hashes only, no video probing or remapping. */
export async function prepareSmokeCuration(): Promise<CurationOutputs> {
  const audit = {} as AuditOutputs;
  for (const name of OUTPUT_NAMES) audit[name] = await readBounded(OUTPUT_ROOT, name);
  const files = await collectSourceFiles();
  verifyBaseline(files);
  const summary = validateAuditPackage(audit, files);
  const media = summary.media as { priorFullDecode?: { readable?: number; corruptOrUnreadable?: number; carriedForwardOnlyAfterSourceDigestVerification?: boolean } };
  assert.equal(media.priorFullDecode?.readable, EXPECTED.videos, "Missing completed readability audit");
  assert.equal(media.priorFullDecode.corruptOrUnreadable, 0, "Audit contains unreadable videos");
  assert.equal(media.priorFullDecode.carriedForwardOnlyAfterSourceDigestVerification, true);
  const records = parseAuditInventory(audit["inventory.jsonl"]);
  const selected = records.filter(record => SMOKE_CLASSES.some(c => c.rawSourceLabel === record.rawSignLabel));
  const byFile = new Map(files.map(file => [file.relativePath, file]));
  for (const sourceCsv of [...new Set(selected.map(record => record.sourceCsv))]) {
    const parsed = parseMetadataCsv(await readBounded(SOURCE_ROOT, sourceCsv), sourceCsv, basename(sourceCsv, ".csv"));
    const byRow = new Map(parsed.map(row => [row.sourceRow, row]));
    for (const record of selected.filter(value => value.sourceCsv === sourceCsv)) {
      const row = byRow.get(record.sourceRow);
      assert(row, "Curation references a missing physical CSV row");
      for (const key of ["category", "metadataFilePath", "metadataFilename", "rawSignLabel", "englishGloss", "declaredSignerId", "durationMetadata", "frameRateMetadata", "frameCountMetadata", "resolutionMetadata", "fileSizeMetadata"] as const) {
        assert.deepEqual(record[key], row[key], `Audit/source metadata mismatch: ${sourceCsv}:${record.sourceRow}:${key}`);
      }
      const video = byFile.get(record.localVideoRelativePath);
      assert(video, "Selected video is missing from verified sources");
      assert.equal(record.sha256, video.sha256, "Selected video content differs from audit");
      assert.equal(record.fileSizeActual, video.size, "Selected video size differs from audit");
    }
  }
  const evidence: CurationEvidence = {
    auditSummarySHA256: sha256(audit["summary.json"]), auditInventorySHA256: sha256(audit["inventory.jsonl"]),
    auditChecksumsSHA256: sha256(audit["checksums.sha256"]),
    videosSHA256: EXPECTED.videoDigest, videosAndCsvSHA256: EXPECTED.datasetDigest,
    sourceFilesVerified: files.length, readabilityEvidence: "prior-full-decode-with-identical-source-hashes",
  };
  const outputs = buildSmokeCuration(records, evidence);
  // A different input traversal must not alter class/sample order, duplicate choice or output hashes.
  assert.deepEqual(outputs, buildSmokeCuration([...records].reverse(), evidence), "Nondeterministic curation manifests");
  validateCurationOutputs(outputs);
  return outputs;
}

/** No clock-dependent fields; coverage is the publication marker for the other artifact hashes. */
export function validateCurationOutputs(outputs: CurationOutputs): void {
  for (const name of CURATION_OUTPUT_NAMES) {
    assert(outputs[name].endsWith("\n"), `Missing output LF: ${name}`);
    if (name.endsWith(".json")) JSON.parse(outputs[name]);
  }
  const vocabulary = JSON.parse(outputs["vocabulary.json"]) as { vocabularyId: string; classes: { classIndex: number; classId: string; rawSourceLabel: string; displayAr: string; linguisticReviewStatus: string }[] };
  assert.equal(vocabulary.vocabularyId, "mosl-smoke5-v1");
  assert.equal(vocabulary.classes.length, 5);
  for (const [index, definition] of vocabulary.classes.entries()) {
    assert.equal(definition.classIndex, index);
    assert.equal(definition.classId, SMOKE_CLASSES[index].classId);
    assert.equal(definition.rawSourceLabel, SMOKE_CLASSES[index].rawSourceLabel);
    assert.equal(definition.displayAr, definition.rawSourceLabel);
    assert.equal(definition.linguisticReviewStatus, "unverified");
  }
  const samples = outputs["samples.jsonl"].trimEnd().split("\n").map(line => JSON.parse(line) as { sampleId: string; sha256: string; eligibility: string; auditMatchStatus: string; classIndex: number; classId: string; rawSourceLabel: string });
  assert.equal(new Set(samples.map(sample => sample.sampleId)).size, samples.length);
  const included = samples.filter(sample => sample.eligibility === "ELIGIBLE_ENGINEERING_ONLY");
  assert.equal(new Set(included.map(sample => sample.sha256)).size, included.length);
  for (const sample of included) {
    assert(["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT"].includes(sample.auditMatchStatus));
    assert.equal(sample.classId, SMOKE_CLASSES[sample.classIndex]?.classId);
    assert.equal(sample.rawSourceLabel, SMOKE_CLASSES[sample.classIndex]?.rawSourceLabel);
    assert(!/^\p{M}+$/u.test(sample.rawSourceLabel));
  }
  const coverage = JSON.parse(outputs["coverage.json"]) as { totalUsableUniqueSamples: number; totalExcludedCandidates: number; candidateRecordCount: number; metadataRowCount: number; artifactSHA256: Record<string, string> };
  const exclusions = JSON.parse(outputs["exclusions.json"]) as { excludedCandidateCount: number; records: { sampleId: string }[] };
  assert.equal(coverage.metadataRowCount, 21);
  assert.equal(coverage.candidateRecordCount, samples.length);
  assert.equal(coverage.totalUsableUniqueSamples, included.length);
  assert.equal(coverage.totalExcludedCandidates, exclusions.records.length);
  assert.equal(exclusions.excludedCandidateCount, exclusions.records.length);
  assert.deepEqual(exclusions.records.map(r => r.sampleId), samples.filter(s => s.eligibility === "EXCLUDED").map(s => s.sampleId));
  for (const name of CURATION_OUTPUT_NAMES.filter(name => name !== "coverage.json")) assert.equal(coverage.artifactSHA256[name], sha256(outputs[name]), `Curation output hash mismatch: ${name}`);
}

/** A rerun verifies the frozen version; it cannot silently replace different or unknown output. */
export async function publishSmokeCuration(outputs: CurationOutputs): Promise<void> {
  validateCurationOutputs(outputs);
  await assertNoLinks(REPOSITORY_ROOT, CURATION_ROOT);
  const missing: typeof CURATION_OUTPUT_NAMES[number][] = [];
  for (const name of CURATION_OUTPUT_NAMES) {
    try {
      assert.equal(await readBounded(CURATION_ROOT, name), outputs[name], `STOP: frozen ${name} differs. Investigate and review the vocabulary version; no output replaced.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(name);
    }
  }
  await mkdir(CURATION_ROOT, { recursive: true });
  const order = [...missing.filter(name => name !== "coverage.json"), ...missing.filter(name => name === "coverage.json")];
  for (const name of order) {
    const target = boundedPath(CURATION_ROOT, name);
    const staging = boundedPath(CURATION_ROOT, `.pending-${name}`);
    await assertNoLinks(REPOSITORY_ROOT, target);
    await assertNoLinks(REPOSITORY_ROOT, staging);
    let owned = false;
    try {
      await writeFile(staging, outputs[name], { encoding: "utf8", flag: "wx" });
      owned = true;
      // Atomic, exclusive publication on the same volume; an existing target is never replaced.
      await link(staging, target);
    } finally {
      if (owned) await unlink(staging);
    }
  }
  for (const name of CURATION_OUTPUT_NAMES) assert.equal(await readBounded(CURATION_ROOT, name), outputs[name], `Persisted curation differs: ${name}`);
}

export async function verifySmokeCuration(outputs: CurationOutputs): Promise<void> {
  const persisted = {} as CurationOutputs;
  for (const name of CURATION_OUTPUT_NAMES) persisted[name] = await readBounded(CURATION_ROOT, name);
  validateCurationOutputs(persisted);
  assert.deepEqual(persisted, outputs, "Frozen curation differs from its verified input");
}

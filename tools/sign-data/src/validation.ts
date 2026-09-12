import assert from "node:assert/strict";
import { OUTPUT_NAMES } from "./auditPackage.ts";
import type { AuditOutputs } from "./auditPackage.ts";
import { EXPECTED, sha256 } from "./sourceFiles.ts";
import type { SourceFile } from "./sourceFiles.ts";

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected JSON object");
  return value as Record<string, unknown>;
}

export function validateAuditPackage(outputs: AuditOutputs, files: SourceFile[]): Record<string, unknown> {
  for (const name of OUTPUT_NAMES) {
    assert.equal(typeof outputs[name], "string", `Missing ${name}`);
    assert(outputs[name].endsWith("\n"), `Missing LF terminator: ${name}`);
    if (name.endsWith(".json")) object(JSON.parse(outputs[name]) as unknown);
  }
  const summary = object(JSON.parse(outputs["summary.json"]) as unknown);
  const records = outputs["inventory.jsonl"].trimEnd().split("\n").map(line => object(JSON.parse(line) as unknown));
  assert.equal(records.length, summary.inventoryRecords);
  assert.equal(records.length, 2218, "Expected 2216 metadata rows plus two additional ambiguous candidate records");
  assert.equal(summary.csvRows, EXPECTED.videos);
  assert.equal(summary.mp4Files, EXPECTED.videos);
  assert.equal(summary.csvFiles, EXPECTED.csvs);
  assert.equal(summary.totalVideoBytes, EXPECTED.videoBytes);
  assert.equal(summary.uniqueVideoContents, 2197);
  assert.equal(summary.duplicateGroups, 10);
  assert.equal(summary.filesInDuplicateGroups, 29);
  assert.equal(summary.excessDuplicateCopies, 19);
  assert.equal(summary.combiningMarkOnlyRowCount, 15);
  assert.equal(summary.combiningMarkOnlyLabelCount, 8);
  assert.equal(summary.missingEnglishGlossColumnRows, 130);
  const statuses = { EXACT: 2170, UNICODE_EQUIVALENT: 37, DETERMINISTIC_NONEXACT: 7, AMBIGUOUS: 2, UNMATCHED: 0 };
  assert.deepEqual(summary.mappingCountsByMetadataRow, statuses);
  const rowStatus = new Map<string, unknown>();
  const paths = new Set<string>();
  const sources = new Map(files.map(f => [f.relativePath, f]));
  const required = ["sourceCsv", "sourceRow", "category", "metadataFilePath", "metadataFilename", "localVideoRelativePath", "rawSignLabel", "englishGloss", "declaredSignerId", "durationMetadata", "durationActual", "frameRateMetadata", "frameRateActual", "frameCountMetadata", "frameCountActual", "resolutionMetadata", "resolutionActual", "fileSizeMetadata", "fileSizeActual", "sha256", "contentDuplicateGroupId", "matchStatus", "matchReason", "usableForLaterCuration", "reviewRequired"];
  for (const record of records) {
    for (const key of required) assert(Object.hasOwn(record, key), `Missing inventory field: ${key}`);
    assert.equal(typeof record.rawSignLabel, "string");
    assert.equal(typeof record.metadataFilename, "string");
    assert.equal(typeof record.localVideoRelativePath, "string");
    assert.equal(typeof record.usableForLaterCuration, "boolean");
    assert.equal(record.reviewRequired, true, "Declared identities and sign semantics remain unverified");
    const rowId = `${record.sourceCsv}:${record.sourceRow}`;
    if (rowStatus.has(rowId)) assert.equal(rowStatus.get(rowId), record.matchStatus);
    rowStatus.set(rowId, record.matchStatus);
    const path = record.localVideoRelativePath as string;
    paths.add(path);
    const file = sources.get(path);
    assert(file, "Inventory references a file outside the verified source inventory");
    assert.equal(record.sha256, file.sha256);
    assert.equal(record.fileSizeActual, file.size);
    for (const field of ["durationActual", "frameRateActual", "frameCountActual"]) assert(typeof record[field] === "number" && Number.isFinite(record[field]) && record[field] > 0);
    if (record.matchStatus === "AMBIGUOUS") assert.equal(record.usableForLaterCuration, false);
    assert(!Object.hasOwn(record, "verifiedSignerId") && !Object.hasOwn(record, "canonicalVocabularyId") && !Object.hasOwn(record, "staticDynamic"), "No inferred identity/vocabulary fields");
  }
  assert.equal(rowStatus.size, 2216);
  assert.equal(paths.size, 2216);
  for (const [status, expected] of Object.entries(statuses)) assert.equal([...rowStatus.values()].filter(value => value === status).length, expected);
  const checksumLines = outputs["checksums.sha256"].trimEnd().split("\n");
  assert.equal(checksumLines.length, files.length);
  assert.deepEqual(checksumLines, files.map(f => `${f.sha256}  ${f.relativePath}`));
  const signerLines = outputs["signer-coverage.csv"].trimEnd().split("\n");
  assert.equal(signerLines[0], "declaredSignerId,rowCount,exactRawLabelCount,categories,identityStatus");
  assert.equal(signerLines.length, 10);
  for (const line of signerLines.slice(1)) assert(/^signer_[1-9],\d+,\d+,[a-zA-Z0-9_|]+,DECLARED_ONLY_UNVERIFIED$/u.test(line), "Invalid declared signer CSV");
  const labels = object(JSON.parse(outputs["label-inventory.json"]) as unknown).labels;
  assert(Array.isArray(labels));
  assert.equal(labels.length, 1610);
  const hashes = object(summary.outputSHA256);
  for (const name of OUTPUT_NAMES.filter(n => n !== "summary.json")) assert.equal(hashes[name], sha256(outputs[name]), `Artifact checksum mismatch: ${name}`);
  assert.equal(object(summary.sourceIntegrity).videosSHA256, EXPECTED.videoDigest);
  assert.equal(object(summary.sourceIntegrity).videosAndCsvSHA256, EXPECTED.datasetDigest);
  assert.equal(object(summary.numericDifferences).substantiveComparisons, 0);
  return summary;
}

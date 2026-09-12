import assert from "node:assert/strict";
import type { MatchStatus, MediaComparison } from "./contracts.ts";
import { compareMedia } from "./mapping.ts";
import { EXPECTED, ordinal, sha256 } from "./sourceFiles.ts";

export const VOCABULARY_ID = "mosl-smoke5-v1";
/** Order and exact source spelling are versioned, never derived from display translations. */
export const SMOKE_CLASSES = Object.freeze([
  { classIndex: 0, classId: "good_morning", rawSourceLabel: "صَبَاحُ الْخَيْرِ", displayEn: "Good morning", expectedRows: 4 },
  { classIndex: 1, classId: "father", rawSourceLabel: "أَبٌ", displayEn: "Father", expectedRows: 5 },
  { classIndex: 2, classId: "market", rawSourceLabel: "سُوقٌ", displayEn: "Market", expectedRows: 5 },
  { classIndex: 3, classId: "gift", rawSourceLabel: "هَدِيَّةٌ", displayEn: "Gift", expectedRows: 3 },
  { classIndex: 4, classId: "police_officer", rawSourceLabel: "شُرْطِيٌّ", displayEn: "Police officer", expectedRows: 4 },
].map(value => Object.freeze(value)));

export interface AuditCurationRecord {
  sourceCsv: string;
  sourceRow: number;
  category: string;
  metadataFilePath: string;
  metadataFilename: string;
  localVideoRelativePath: string;
  rawSignLabel: string;
  englishGloss: string | null;
  declaredSignerId: string;
  sha256: string;
  durationMetadata: number | null;
  durationActual: number | null;
  frameRateMetadata: number | null;
  frameRateActual: number | null;
  frameCountMetadata: number | null;
  frameCountActual: number | null;
  resolutionMetadata: { width: number | null; height: number | null };
  resolutionActual: { width: number | null; height: number | null };
  fileSizeMetadata: number | null;
  fileSizeActual: number | null;
  matchStatus: MatchStatus;
  matchReason: string;
  contentDuplicateGroupId: string | null;
  mediaComparison: MediaComparison | null;
  usableForLaterCuration: boolean;
  reviewReasons: string[];
}

export interface CurationEvidence {
  auditSummarySHA256: string;
  auditInventorySHA256: string;
  auditChecksumsSHA256: string;
  videosSHA256: string;
  videosAndCsvSHA256: string;
  sourceFilesVerified: number;
  readabilityEvidence: "prior-full-decode-with-identical-source-hashes";
}

export const CURATION_OUTPUT_NAMES = ["vocabulary.json", "samples.jsonl", "exclusions.json", "coverage.json", "review.md"] as const;
export type CurationOutputs = Record<typeof CURATION_OUTPUT_NAMES[number], string>;
export type ExclusionReason = "MAPPING_NOT_ACCEPTED" | "SUSPICIOUS_METADATA" | "INVALID_MEDIA_OR_METADATA" | "AUDIT_INELIGIBLE" | "CONTENT_SHARED_WITH_OTHER_LABEL" | "DUPLICATE_CONTENT";
const accepted = new Set<MatchStatus>(["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT"]);
const statuses = new Set<MatchStatus>([...accepted, "AMBIGUOUS", "UNMATCHED"]);
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const unique = (values: readonly string[]): string[] => [...new Set(values)].sort(ordinal);
const rowId = (value: AuditCurationRecord): string => `${value.sourceCsv}:${value.sourceRow}`;
const positive = (value: number | null): boolean => typeof value === "number" && Number.isFinite(value) && value > 0;

function verifiedMedia(record: AuditCurationRecord): boolean {
  const numeric = [record.durationMetadata, record.durationActual, record.frameRateMetadata, record.frameRateActual, record.frameCountMetadata, record.frameCountActual, record.fileSizeMetadata, record.fileSizeActual, record.resolutionMetadata.width, record.resolutionMetadata.height, record.resolutionActual.width, record.resolutionActual.height];
  const integers = [record.frameCountMetadata, record.frameCountActual, record.fileSizeMetadata, record.fileSizeActual, record.resolutionMetadata.width, record.resolutionMetadata.height, record.resolutionActual.width, record.resolutionActual.height];
  if (!numeric.every(positive) || !integers.every(n => Number.isSafeInteger(n))) return false;
  // Reuse the existing numeric policy; this checks a selected record, never reruns filename mapping.
  return compareMedia({
    ...record, raw: {}, durationMetadata: record.durationMetadata!, frameRateMetadata: record.frameRateMetadata!,
    frameCountMetadata: record.frameCountMetadata!, fileSizeMetadata: record.fileSizeMetadata!,
    resolutionMetadata: { width: record.resolutionMetadata.width!, height: record.resolutionMetadata.height! },
  }, {
    relativePath: record.localVideoRelativePath, filename: record.localVideoRelativePath.split("/").at(-1)!,
    category: record.category, size: record.fileSizeActual!, sha256: record.sha256,
    media: { readable: true, duration: record.durationActual, frameRate: record.frameRateActual, frameRateRational: null,
      frameCount: record.frameCountActual, width: record.resolutionActual.width, height: record.resolutionActual.height },
  }).supportsAssociation;
}

/** Reject traversal/Windows alternate streams; Unicode is left untouched. */
export function validateSourceReference(value: string, kind: "videos" | "metadata"): void {
  assert(value.startsWith(`${kind}/`) && !/[\\:\p{Cc}]/u.test(value), "Unsafe source reference");
  assert(value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "Unsafe source reference");
  assert(value.endsWith(kind === "videos" ? ".mp4" : ".csv"), "Unexpected source extension");
}

/** Parse the persisted, hash-checked audit; do not redo filename association. */
export function parseAuditInventory(text: string): AuditCurationRecord[] {
  assert(text.endsWith("\n"), "Audit inventory must end in LF");
  return text.trimEnd().split("\n").map((line, index) => {
    const value = JSON.parse(line) as AuditCurationRecord;
    assert(value && typeof value === "object", `Invalid audit record ${index + 1}`);
    for (const field of ["sourceCsv", "category", "metadataFilePath", "metadataFilename", "localVideoRelativePath", "rawSignLabel", "declaredSignerId", "sha256", "matchReason"] as const) {
      assert(typeof value[field] === "string" && value[field].length > 0, `Invalid ${field} at audit record ${index + 1}`);
    }
    assert(Number.isSafeInteger(value.sourceRow) && value.sourceRow >= 2, "Invalid physical CSV row");
    validateSourceReference(value.sourceCsv, "metadata");
    validateSourceReference(value.localVideoRelativePath, "videos");
    assert(/^[0-9a-f]{64}$/u.test(value.sha256), "Invalid audit SHA-256");
    assert(statuses.has(value.matchStatus), "Unknown audit mapping status");
    assert(typeof value.usableForLaterCuration === "boolean" && Array.isArray(value.reviewReasons) && value.reviewReasons.every(r => typeof r === "string"), "Invalid audit eligibility");
    assert(value.contentDuplicateGroupId === null || value.contentDuplicateGroupId === `sha256:${value.sha256}`, "Invalid duplicate group");
    for (const field of ["durationMetadata", "durationActual", "frameRateMetadata", "frameRateActual", "frameCountMetadata", "frameCountActual", "fileSizeMetadata", "fileSizeActual"] as const) {
      assert(value[field] === null || typeof value[field] === "number", `Invalid numeric field: ${field}`);
    }
    for (const field of ["resolutionMetadata", "resolutionActual"] as const) {
      assert(value[field] && [value[field].width, value[field].height].every(n => n === null || typeof n === "number"), "Invalid resolution schema");
    }
    assert(value.mediaComparison === null || (typeof value.mediaComparison.supportsAssociation === "boolean" && Array.isArray(value.mediaComparison.differences)), "Invalid media comparison schema");
    assert(value.englishGloss === null || typeof value.englishGloss === "string", "Invalid gloss schema");
    return value;
  });
}

export function stableSampleId(value: AuditCurationRecord): string {
  return `${VOCABULARY_ID}:${sha256(JSON.stringify([VOCABULARY_ID, value.sourceCsv, value.sourceRow, value.localVideoRelativePath]))}`;
}

export function buildSmokeCuration(records: readonly AuditCurationRecord[], evidence: CurationEvidence): CurationOutputs {
  assert.equal(evidence.videosSHA256, EXPECTED.videoDigest, "Known video digest required");
  assert.equal(evidence.videosAndCsvSHA256, EXPECTED.datasetDigest, "Known dataset digest required");
  assert.equal(evidence.sourceFilesVerified, 2221, "Whole-source checksum verification required");
  assert.equal(evidence.readabilityEvidence, "prior-full-decode-with-identical-source-hashes");
  for (const digest of [evidence.auditSummarySHA256, evidence.auditInventorySHA256, evidence.auditChecksumsSHA256]) assert(/^[0-9a-f]{64}$/u.test(digest));

  const selected = SMOKE_CLASSES.flatMap(definition => {
    const members = records.filter(record => record.rawSignLabel === definition.rawSourceLabel);
    assert.equal(new Set(members.map(rowId)).size, definition.expectedRows, `STOP: ${definition.classId} exact raw-label row count differs; do not substitute or normalize`);
    return [...members].sort((a, b) => ordinal(a.sourceCsv, b.sourceCsv) || a.sourceRow - b.sourceRow || ordinal(a.localVideoRelativePath, b.localVideoRelativePath)).map(record => ({ definition, record }));
  });
  const ids = new Set<string>();
  const includedByHash = new Map<string, string>();
  const samples = selected.map(({ definition, record }) => {
    validateSourceReference(record.sourceCsv, "metadata");
    validateSourceReference(record.localVideoRelativePath, "videos");
    const sampleId = stableSampleId(record);
    assert(!ids.has(sampleId), "Duplicate inventory candidate; refusing to count a repeated record");
    ids.add(sampleId);
    const reasons: ExclusionReason[] = [];
    if (!accepted.has(record.matchStatus)) reasons.push("MAPPING_NOT_ACCEPTED");
    if (/^\p{M}+$/u.test(record.rawSignLabel) || record.reviewReasons.includes("COMBINING_MARK_ONLY_LABEL")) reasons.push("SUSPICIOUS_METADATA");
    if (!verifiedMedia(record) || record.mediaComparison?.supportsAssociation !== true || record.mediaComparison.differences.some(d => d.kind !== "ACCEPTED_TOLERANCE")) reasons.push("INVALID_MEDIA_OR_METADATA");
    if (!record.usableForLaterCuration) reasons.push("AUDIT_INELIGIBLE");
    const related = records.filter(other => other.sha256 === record.sha256);
    if (related.some(other => other.rawSignLabel !== record.rawSignLabel)) reasons.push("CONTENT_SHARED_WITH_OTHER_LABEL");
    let duplicateOfSampleId: string | null = null;
    if (reasons.length === 0) {
      duplicateOfSampleId = includedByHash.get(record.sha256) ?? null;
      if (duplicateOfSampleId) reasons.push("DUPLICATE_CONTENT");
      else includedByHash.set(record.sha256, sampleId);
    }
    return {
      sampleId, classId: definition.classId, classIndex: definition.classIndex,
      sourceCsv: record.sourceCsv, sourceRow: record.sourceRow, category: record.category,
      metadataFilePath: record.metadataFilePath, metadataFilename: record.metadataFilename,
      localVideoRelativePath: record.localVideoRelativePath, rawSourceLabel: record.rawSignLabel,
      sourceEnglishGloss: record.englishGloss, declaredSignerId: record.declaredSignerId,
      identityStatus: "DECLARED_ONLY_UNVERIFIED", sha256: record.sha256,
      duration: record.durationActual, frameRate: record.frameRateActual, frameCount: record.frameCountActual,
      resolution: record.resolutionActual, fileSizeBytes: record.fileSizeActual,
      auditMatchStatus: record.matchStatus, auditMatchReason: record.matchReason,
      duplicateGroupId: record.contentDuplicateGroupId ?? (new Set(related.map(r => r.localVideoRelativePath)).size > 1 ? `sha256:${record.sha256}` : null),
      contentProvenance: related.map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, localVideoRelativePath: r.localVideoRelativePath, rawSourceLabel: r.rawSignLabel })).sort((a, b) => ordinal(a.sourceCsv, b.sourceCsv) || a.sourceRow - b.sourceRow || ordinal(a.localVideoRelativePath, b.localVideoRelativePath)),
      eligibility: reasons.length === 0 ? "ELIGIBLE_ENGINEERING_ONLY" : "EXCLUDED",
      exclusionReason: reasons[0] ?? null, exclusionReasons: reasons, duplicateOfSampleId,
      readabilityEvidence: evidence.readabilityEvidence,
      acceptedNumericDifferences: record.mediaComparison?.differences.filter(d => d.kind === "ACCEPTED_TOLERANCE") ?? [],
      linguisticReviewStatus: "unverified", auditReviewReasons: record.reviewReasons,
    };
  });
  const classes = SMOKE_CLASSES.map(definition => {
    const members = samples.filter(sample => sample.classId === definition.classId);
    const usable = members.filter(sample => sample.eligibility === "ELIGIBLE_ENGINEERING_ONLY");
    const excluded = members.filter(sample => sample.eligibility === "EXCLUDED");
    return {
      classId: definition.classId, classIndex: definition.classIndex, rawSourceLabel: definition.rawSourceLabel,
      metadataRowCount: new Set(members.map(s => `${s.sourceCsv}:${s.sourceRow}`)).size,
      candidateRecordCount: members.length, uniqueUsableVideoContentCount: new Set(usable.map(s => s.sha256)).size,
      declaredSignerIds: unique(members.map(s => s.declaredSignerId)),
      excludedDuplicates: excluded.filter(s => s.exclusionReasons.includes("DUPLICATE_CONTENT")).length,
      technicalExclusions: excluded.filter(s => !s.exclusionReasons.includes("DUPLICATE_CONTENT")).length,
      unresolvedMappings: new Set(members.filter(s => !accepted.has(s.auditMatchStatus)).map(s => `${s.sourceCsv}:${s.sourceRow}`)).size,
      duplicateGroupIds: unique(members.flatMap(s => s.duplicateGroupId ? [s.duplicateGroupId] : [])),
      linguisticReviewStatus: "unverified",
    };
  });
  // One unique recording would only repeat a single instance, not exercise this small multi-example subset.
  const blocked = classes.filter(c => c.uniqueUsableVideoContentCount < 2);
  assert.equal(blocked.length, 0, `STOP: classes without at least two unique eligible recordings: ${blocked.map(c => c.classId).join(", ")}. Human selection required; no replacement was made.`);
  const eligible = samples.filter(sample => sample.eligibility === "ELIGIBLE_ENGINEERING_ONLY");
  assert.equal(new Set(eligible.map(s => s.sha256)).size, eligible.length, "Duplicate content counted twice");
  const vocabulary = {
    schemaVersion: 1, vocabularyId: VOCABULARY_ID, purpose: "ENGINEERING_SMOKE_TEST_ONLY",
    classOrderPolicy: "Changing class order, membership or exact source labels requires a new vocabulary version.",
    selectionBasis: "User-proposed better-populated engineering candidates, verified by exact raw-label audit lookup.",
    displayTextProvenance: "User-supplied English display text; Arabic display preserves the exact source label. Neither is qualified linguistic validation.",
    classes: SMOKE_CLASSES.map(definition => ({ classIndex: definition.classIndex, classId: definition.classId, rawSourceLabel: definition.rawSourceLabel, displayEn: definition.displayEn, displayAr: definition.rawSourceLabel, linguisticReviewStatus: "unverified", enabledForEngineeringSmokeTest: true })),
    evidence,
  };
  const exclusions = samples.filter(s => s.eligibility === "EXCLUDED");
  const coverage = {
    schemaVersion: 1, vocabularyId: VOCABULARY_ID, classes,
    metadataRowCount: classes.reduce((count, c) => count + c.metadataRowCount, 0), candidateRecordCount: samples.length,
    totalUsableUniqueSamples: eligible.length, totalExcludedCandidates: exclusions.length,
    totalExcludedDuplicates: classes.reduce((count, c) => count + c.excludedDuplicates, 0),
    totalTechnicalExclusions: classes.reduce((count, c) => count + c.technicalExclusions, 0),
    signerIndependentEvaluationPermitted: false, splitsCreated: false,
    status: "READY_FOR_OFFLINE_LANDMARK_EXTRACTION_ENGINEERING_ONLY",
    evidence, artifactSHA256: {} as Record<string, string>,
  };
  const outputs: CurationOutputs = {
    "vocabulary.json": json(vocabulary),
    "samples.jsonl": samples.map(sample => JSON.stringify(sample)).join("\n") + "\n",
    "exclusions.json": json({ schemaVersion: 1, vocabularyId: VOCABULARY_ID, excludedCandidateCount: exclusions.length, records: exclusions, duplicatePolicy: "Within-class eligible content uses the first reference by ordinal CSV path, numeric physical row, then ordinal video path. Other copies remain explicit exclusions. Cross-label identical content is excluded pending review. No source is deleted or assigned a linguistic canonical form." }),
    "coverage.json": "",
    "review.md": `# MoSL five-sign engineering curation — smoke5-v1\n\n## TECHNICAL CURATION\n\nVocabulary: ${VOCABULARY_ID}. These five user-proposed candidates have relatively more source rows for a small pipeline exercise. Exact label counts were verified without normalization, English-gloss grouping, or filename-based variant inference.\n\n| Index | Class ID | Exact raw Arabic label | Metadata rows | Unique eligible recordings | Declared signer IDs |\n|---|---|---|---:|---:|---|\n${classes.map(c => `| ${c.classIndex} | ${c.classId} | ${c.rawSourceLabel} | ${c.metadataRowCount} | ${c.uniqueUsableVideoContentCount} | ${c.declaredSignerIds.join(", ")} |`).join("\n")}\n\nTotal: ${coverage.metadataRowCount} metadata rows, ${samples.length} candidate records, ${eligible.length} unique eligible recordings. ${exclusions.length} excluded candidates (${coverage.totalExcludedDuplicates} within-class duplicates, ${coverage.totalTechnicalExclusions} technical exclusions). See exclusions.json for every exclusion and samples.jsonl for all provenance.\n\nOnly accepted audit mappings with supporting media properties qualify. Exact content is counted once; the deterministic reference rule is a storage/provenance decision, never a sign-variant decision. Identical content assigned to different raw labels is withheld for review. All selected raw files exist and their SHA-256/size agree with the audit. Readability carries forward the completed full decode only after source-hash verification; no videos were decoded again. Accepted rounding differences remain in each sample.\n\n## LINGUISTICALLY / IDENTITY UNVERIFIED\n\nEvery class has linguisticReviewStatus: unverified. English display texts were supplied by the user; displayAr preserves the raw source label. This is not qualified Moroccan Sign Language coverage, a production vocabulary, the final 20-sign vocabulary, or a generalization benchmark. No movement type, regional variant, semantic equivalence, hand requirement or facial-expression requirement was inferred. No video-content linguistic review was performed.\n\nThe source audit assigns each exact label to one DECLARED signer and identifies a repeating nine-ID assignment pattern. These are not verified global human identities. The selected classes cannot support a signer-independent claim. No train/validation/test split was made. Three to five examples per class are sufficient only to start an engineering exercise; they do not establish useful recognition accuracy or ordinary-webcam performance.\n\n## Reproducibility and integrity\n\nPaths are relative to data/scope5/source/mosl-v1/. UTF-8/LF outputs use ordinal ordering without destructive Unicode normalization. sampleId is ${VOCABULARY_ID}: followed by SHA-256 of JSON.stringify([vocabularyId, sourceCsv, physical sourceRow, localVideoRelativePath]); CSV row numbers include the header. Output has no clock-dependent fields. coverage.json hashes the other four artifacts. Existing frozen output is never silently changed: a differing manifest requires investigation and a reviewed version decision.\n\nAudit summary SHA-256: ${evidence.auditSummarySHA256}\n\nVideos aggregate SHA-256: ${evidence.videosSHA256}\n\nVideos + CSV aggregate SHA-256: ${evidence.videosAndCsvSHA256}\n\nSource bytes and the original audit were read only. All ${evidence.sourceFilesVerified} source hashes were checked against the prior audit; referenced CSV rows were checked against the unchanged source metadata. No raw data was copied, moved, renamed or edited. Private outputs remain under the existing data/scope5/ Git ignore rule.\n\n## Next-phase boundary\n\nREADY for offline MediaPipe landmark extraction of these engineering samples only, after an explicit next-phase instruction. Linguistic/identity review remains outstanding. No extraction, tensors, splits, training, ONNX export, browser recognition or production UI changes were performed.\n`,
  };
  for (const name of CURATION_OUTPUT_NAMES.filter(name => name !== "coverage.json")) coverage.artifactSHA256[name] = sha256(outputs[name]);
  outputs["coverage.json"] = json(coverage);
  return outputs;
}

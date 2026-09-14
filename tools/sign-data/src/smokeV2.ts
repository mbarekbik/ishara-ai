import assert from 'node:assert/strict';
import { CONTRACT, FEATURE_WIDTH, POLICY, SEQUENCE_LENGTH } from '../../../shared/sign-preprocessing/schema.ts';
import type { AuditCurationRecord, CurationEvidence, CurationOutputs } from './curation.ts';
import { CURATION_OUTPUT_NAMES, SMOKE_CLASSES, validateSourceReference, VOCABULARY_ID } from './curation.ts';
import type { ExtractionSample } from './extractionModel.ts';
import type { createIndexRecord } from './featureFiles.ts';
import { compareMedia } from './mapping.ts';
import { EXPECTED, sha256 } from './sourceFiles.ts';

export const V2_ID = 'mosl-smoke5-v2';
export const V2_CLASSES = Object.freeze([
  ...SMOKE_CLASSES.slice(0, 4),
  Object.freeze({ classIndex: 4, classId: 'love_like', rawSourceLabel: 'أَحَبَّ', displayEn: 'Love / Like', expectedRows: 5 }),
]);
export const V2_NEW_ROWS = Object.freeze([1664, 1666, 1668, 1669, 1670]);
export const V2_REPLACEMENT = Object.freeze({
  from: 'police_officer', to: 'love_like',
  reason: 'police_officer had zero quality-eligible tensors under the unchanged engineering quality policy; love_like was explicitly approved after bounded technical screening.',
});
const digestPattern = /^[0-9a-f]{64}$/u;
const accepted = ['EXACT', 'UNICODE_EQUIVALENT', 'DETERMINISTIC_NONEXACT'] as const;
const ordinaryReviewReasons = new Set(['DECLARED_SIGNER_ID_UNVERIFIED', 'LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED']);
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

export interface V2VocabularyClass {
  classIndex: number; classId: string; rawSourceLabel: string; displayEn: string; displayAr: string;
  linguisticReviewStatus: 'unverified'; enabledForEngineeringSmokeTest: true;
  [key: string]: unknown;
}
export interface V2ParentVocabulary {
  schemaVersion: number; vocabularyId: string; purpose: string; classes: V2VocabularyClass[];
  evidence: CurationEvidence;
  [key: string]: unknown;
}
export interface V2VerifiedSource {
  sourceCsv: string; sourceRow: number; localVideoRelativePath: string; sha256: string; size: number;
}
export interface V2CurationEvidence extends CurationEvidence {
  parentCurationSHA256: Record<string, string>;
  /** Populated only after reading each physical source file and checking it against the persisted audit. */
  verifiedNewSources: V2VerifiedSource[];
}
export type V2ArtifactOrigin = 'inherited_smoke5_v1' | 'derived_smoke5_v2';
export interface V2Sample extends ExtractionSample {
  artifactOrigin: V2ArtifactOrigin;
  reusedFrom: { datasetId: typeof VOCABULARY_ID; sampleId: string } | null;
}

/** Canonical local names support inherited IDs without relaxing path safety. */
export function v2SamplePath(sampleId: string, extension: 'jsonl' | 'f32'): string {
  assert(/^mosl-smoke5-v[12]:[0-9a-f]{64}$/u.test(sampleId), 'Unsafe or unsupported v2 sample ID');
  assert(extension === 'jsonl' || extension === 'f32', 'Unsupported sample artifact extension');
  return `samples/${encodeURIComponent(sampleId)}.${extension}`;
}

function positive(value: number | null, label: string, integer = false): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value) && value > 0 && (!integer || Number.isSafeInteger(value)), `Invalid ${label}`);
}

function validateNewRecord(record: AuditCurationRecord, records: readonly AuditCurationRecord[], evidence: V2CurationEvidence): void {
  validateSourceReference(record.sourceCsv, 'metadata');
  validateSourceReference(record.localVideoRelativePath, 'videos');
  assert(digestPattern.test(record.sha256), 'Invalid new source SHA-256');
  assert(accepted.some(status => status === record.matchStatus), 'Mapping not accepted');
  assert.equal(record.usableForLaterCuration, true, 'Audit ineligible');
  assert(record.reviewReasons.every(reason => ordinaryReviewReasons.has(reason)), 'Suspicious or unresolved audit metadata');
  assert(record.matchReason.length > 0 && record.declaredSignerId.length > 0, 'Missing source provenance');
  assert.equal(record.contentDuplicateGroupId, null, 'Duplicate content cannot be an independent sample');
  assert.equal(records.filter(other => other.sourceCsv === record.sourceCsv && other.sourceRow === record.sourceRow).length, 1, 'Ambiguous or repeated audit source row');
  assert.equal(records.filter(other => other.sha256 === record.sha256).length, 1, 'Duplicate content or cross-label content');
  assert.equal(records.filter(other => other.localVideoRelativePath === record.localVideoRelativePath).length, 1, 'Repeated source video mapping');
  for (const field of ['durationMetadata', 'durationActual', 'frameRateMetadata', 'frameRateActual'] as const) positive(record[field], field);
  for (const field of ['frameCountMetadata', 'frameCountActual', 'fileSizeMetadata', 'fileSizeActual'] as const) positive(record[field], field, true);
  for (const field of ['resolutionMetadata', 'resolutionActual'] as const) {
    positive(record[field].width, `${field}.width`, true); positive(record[field].height, `${field}.height`, true);
  }
  const comparison = compareMedia({
    ...record, raw: {}, durationMetadata: record.durationMetadata!, frameRateMetadata: record.frameRateMetadata!,
    frameCountMetadata: record.frameCountMetadata!, fileSizeMetadata: record.fileSizeMetadata!,
    resolutionMetadata: { width: record.resolutionMetadata.width!, height: record.resolutionMetadata.height! },
  }, {
    relativePath: record.localVideoRelativePath, filename: record.localVideoRelativePath.split('/').at(-1)!,
    category: record.category, size: record.fileSizeActual!, sha256: record.sha256,
    media: { readable: true, duration: record.durationActual, frameRate: record.frameRateActual, frameRateRational: null,
      frameCount: record.frameCountActual, width: record.resolutionActual.width, height: record.resolutionActual.height },
  });
  assert(comparison.supportsAssociation && comparison.differences.every(item => item.kind === 'ACCEPTED_TOLERANCE'), 'Invalid media or metadata');
  assert(record.mediaComparison?.supportsAssociation && record.mediaComparison.differences.every(item => item.kind === 'ACCEPTED_TOLERANCE'), 'Persisted audit media is not clean');
  const verified = evidence.verifiedNewSources.filter(source => source.sourceCsv === record.sourceCsv && source.sourceRow === record.sourceRow);
  assert.equal(verified.length, 1, 'Missing or repeated physical source verification');
  assert.equal(verified[0].localVideoRelativePath, record.localVideoRelativePath, 'Physical source reference differs');
  assert.equal(verified[0].sha256, record.sha256, 'Physical source SHA-256 differs from audit');
  assert.equal(verified[0].size, record.fileSizeActual, 'Physical source size differs from audit');
}

/** Compose frozen source identities; inherited samples are never selected again from the audit. */
export function buildV2Curation(parentVocabulary: V2ParentVocabulary, parentSamples: readonly ExtractionSample[], records: readonly AuditCurationRecord[], evidence: V2CurationEvidence) {
  assert.equal(parentVocabulary.schemaVersion, 1);
  assert.equal(parentVocabulary.vocabularyId, VOCABULARY_ID);
  assert.equal(parentVocabulary.purpose, 'ENGINEERING_SMOKE_TEST_ONLY');
  assert.equal(parentVocabulary.classes.length, 5, 'Expected frozen parent vocabulary');
  for (const [index, definition] of parentVocabulary.classes.entries()) {
    const expected = SMOKE_CLASSES[index];
    for (const key of ['classIndex', 'classId', 'rawSourceLabel', 'displayEn'] as const) assert.equal(definition[key], expected[key], `Parent class identity differs: ${key}`);
    assert.equal(definition.displayAr, expected.rawSourceLabel);
    assert.equal(definition.linguisticReviewStatus, 'unverified');
    assert.equal(definition.enabledForEngineeringSmokeTest, true);
  }
  assert.equal(evidence.videosSHA256, EXPECTED.videoDigest, 'Known source video digest required');
  assert.equal(evidence.videosAndCsvSHA256, EXPECTED.datasetDigest, 'Known source dataset digest required');
  assert.equal(evidence.sourceFilesVerified, 2221, 'Whole-source checksum verification required');
  assert.equal(evidence.readabilityEvidence, 'prior-full-decode-with-identical-source-hashes');
  for (const digest of [evidence.auditSummarySHA256, evidence.auditInventorySHA256, evidence.auditChecksumsSHA256]) assert(digestPattern.test(digest), 'Invalid audit artifact hash');
  for (const name of CURATION_OUTPUT_NAMES) assert(digestPattern.test(evidence.parentCurationSHA256[name]), `Missing frozen parent curation hash: ${name}`);
  assert.equal(evidence.verifiedNewSources.length, 5, 'Expected five independently verified new sources');
  assert.equal(parentSamples.length, 21, 'Expected complete frozen parent samples');
  assert.equal(new Set(parentSamples.map(sample => sample.sampleId)).size, 21, 'Repeated parent identity');
  for (const definition of SMOKE_CLASSES) {
    const members = parentSamples.filter(sample => sample.classId === definition.classId);
    assert.equal(members.length, definition.expectedRows, 'Parent class count differs');
    for (const sample of members) {
      assert.equal(sample.classIndex, definition.classIndex, 'Parent sample class index differs');
      assert.equal(sample.rawSourceLabel, definition.rawSourceLabel, 'Parent sample raw label differs');
      assert.equal(sample.sampleId, `${VOCABULARY_ID}:${sha256(JSON.stringify([VOCABULARY_ID, sample.sourceCsv, sample.sourceRow, sample.localVideoRelativePath]))}`, 'Parent sample identity differs');
      assert.equal(sample.eligibility, 'ELIGIBLE_ENGINEERING_ONLY');
      assert(digestPattern.test(sample.sha256), 'Invalid inherited source hash');
    }
  }
  const inherited: V2Sample[] = parentSamples.filter(sample => sample.classIndex < 4).map(sample => ({
    ...structuredClone(sample), artifactOrigin: 'inherited_smoke5_v1', reusedFrom: { datasetId: VOCABULARY_ID, sampleId: sample.sampleId },
  }));
  assert.equal(inherited.length, 17, 'Expected exactly seventeen inherited identities');
  const definition = V2_CLASSES[4];
  const selected = records.filter(record => record.rawSignLabel === definition.rawSourceLabel).sort((a, b) => a.sourceRow - b.sourceRow);
  assert.deepEqual(selected.map(record => record.sourceRow), V2_NEW_ROWS, 'Approved love_like exact raw-label rows differ');
  const derived: V2Sample[] = selected.map(record => {
    assert.equal(record.englishGloss, definition.displayEn, 'Exact source gloss must remain Love / Like');
    validateNewRecord(record, records, evidence);
    assert(accepted.some(status => status === record.matchStatus));
    return {
      sampleId: `${V2_ID}:${sha256(JSON.stringify([V2_ID, record.sourceCsv, record.sourceRow, record.localVideoRelativePath]))}`,
      classId: definition.classId, classIndex: definition.classIndex, sourceCsv: record.sourceCsv, sourceRow: record.sourceRow,
      category: record.category, metadataFilePath: record.metadataFilePath, metadataFilename: record.metadataFilename,
      localVideoRelativePath: record.localVideoRelativePath, rawSourceLabel: record.rawSignLabel, sourceEnglishGloss: record.englishGloss,
      declaredSignerId: record.declaredSignerId, identityStatus: 'DECLARED_ONLY_UNVERIFIED', sha256: record.sha256,
      duration: record.durationActual!, frameRate: record.frameRateActual!, frameCount: record.frameCountActual!,
      resolution: { width: record.resolutionActual.width!, height: record.resolutionActual.height! }, fileSizeBytes: record.fileSizeActual!,
      auditMatchStatus: record.matchStatus as ExtractionSample['auditMatchStatus'], auditMatchReason: record.matchReason,
      duplicateGroupId: null, contentProvenance: [{ sourceCsv: record.sourceCsv, sourceRow: record.sourceRow, localVideoRelativePath: record.localVideoRelativePath, rawSourceLabel: record.rawSignLabel }],
      eligibility: 'ELIGIBLE_ENGINEERING_ONLY', exclusionReason: null, exclusionReasons: [], duplicateOfSampleId: null,
      readabilityEvidence: evidence.readabilityEvidence, linguisticReviewStatus: 'unverified', auditReviewReasons: [...record.reviewReasons],
      acceptedNumericDifferences: structuredClone(record.mediaComparison!.differences),
      artifactOrigin: 'derived_smoke5_v2', reusedFrom: null,
    };
  });
  const samples = [...inherited, ...derived];
  assert.equal(samples.length, 22);
  assert.equal(new Set(samples.map(sample => sample.sampleId)).size, 22, 'Duplicate sample identity');
  assert.equal(new Set(samples.map(sample => sample.sha256)).size, 22, 'Duplicate recording content');
  assert.equal(new Set(samples.map(sample => sample.localVideoRelativePath)).size, 22, 'Duplicate source path');
  assert.equal(new Set(samples.map(sample => `${sample.sourceCsv}:${sample.sourceRow}`)).size, 22, 'Duplicate source row');
  const provenance = { parentDataset: VOCABULARY_ID, replacement: V2_REPLACEMENT };
  const vocabulary = {
    ...structuredClone(parentVocabulary), vocabularyId: V2_ID, datasetId: V2_ID, ...provenance,
    selectionBasis: 'Explicitly approved engineering replacement; seventeen parent identities inherited unchanged and five exact love_like audit rows accepted.',
    displayTextProvenance: 'Indices 0–3 retain their parent definitions. Love / Like is the exact audited source gloss; Arabic remains the exact raw label. Linguistic review is unverified.',
    classes: [...structuredClone(parentVocabulary.classes.slice(0, 4)), {
      classIndex: 4, classId: definition.classId, rawSourceLabel: definition.rawSourceLabel, displayEn: definition.displayEn,
      displayAr: definition.rawSourceLabel, linguisticReviewStatus: 'unverified', enabledForEngineeringSmokeTest: true,
    }], evidence: structuredClone(evidence),
  };
  const exclusions = {
    schemaVersion: 1, vocabularyId: V2_ID, ...provenance, excludedCandidateCount: 0, records: [],
    omittedParentSamples: parentSamples.filter(sample => sample.classId === 'police_officer').map(sample => ({ sampleId: sample.sampleId, classId: sample.classId, sourceCsv: sample.sourceCsv, sourceRow: sample.sourceRow, sha256: sample.sha256 })),
    omissionReason: 'Approved vocabulary replacement in v2 only; parent artifacts remain immutable.',
  };
  const coverage = {
    schemaVersion: 1, vocabularyId: V2_ID, ...provenance,
    classes: V2_CLASSES.map(item => ({ classId: item.classId, classIndex: item.classIndex, rawSourceLabel: item.rawSourceLabel,
      metadataRowCount: item.expectedRows, candidateRecordCount: item.expectedRows, uniqueUsableVideoContentCount: item.expectedRows,
      inheritedSourceCount: item.classIndex < 4 ? item.expectedRows : 0, newSourceCount: item.classIndex === 4 ? 5 : 0,
      linguisticReviewStatus: 'unverified' })),
    metadataRowCount: samples.length, candidateRecordCount: samples.length, totalUsableUniqueSamples: samples.length,
    totalExcludedCandidates: 0, totalExcludedDuplicates: 0, totalTechnicalExclusions: 0,
    inheritedSourceCount: inherited.length, newSourceCount: derived.length,
    signerIndependentEvaluationPermitted: false, splitsCreated: false,
    status: 'READY_FOR_OFFLINE_LANDMARK_EXTRACTION_ENGINEERING_ONLY', evidence: structuredClone(evidence), artifactSHA256: {} as Record<string, string>,
  };
  const review = [
    '# MoSL five-sign engineering curation — smoke5-v2', '',
    `Dataset: ${V2_ID}. Parent: ${VOCABULARY_ID}.`, '', V2_REPLACEMENT.reason, '',
    '| Index | Class ID | Exact raw label | Recordings | Origin |', '|---:|---|---|---:|---|',
    ...V2_CLASSES.map(item => `| ${item.classIndex} | ${item.classId} | ${item.rawSourceLabel} | ${item.expectedRows} | ${item.classIndex < 4 ? 'Inherited unchanged' : 'New accepted curation'} |`), '',
    'The seventeen parent source identities and first four vocabulary definitions are preserved exactly. The four police_officer rows are omitted only from v2; no parent file is modified or deleted.',
    'New love_like rows are 1664, 1666, 1668, 1669 and 1670. Each exact raw label, audited Love / Like gloss, accepted mapping, clean media metadata, independent content and physically verified source hash is required.',
    'The accepted v2 tree materializes inherited landmarks and PASS tensors byte-for-byte, with source and destination hashes checked and reusedFrom provenance. Inherited artifacts require no MediaPipe inference or preprocessing. Only love_like is newly derived; diagnostic artifacts are evidence only.',
    'All classes remain linguistically unverified and engineering-only. Love / Like is not reinterpreted as I love you. Declared signer IDs are unverified; this subset does not establish signer-independent or statistical adequacy. No training or splits are included.', '',
  ].join('\n');
  const outputs: CurationOutputs = {
    'vocabulary.json': json(vocabulary), 'samples.jsonl': samples.map(sample => JSON.stringify(sample)).join('\n') + '\n',
    'exclusions.json': json(exclusions), 'coverage.json': '', 'review.md': review,
  };
  for (const name of CURATION_OUTPUT_NAMES) if (name !== 'coverage.json') coverage.artifactSHA256[name] = sha256(outputs[name]);
  outputs['coverage.json'] = json(coverage);
  return { vocabulary, samples, exclusions, coverage, review, outputs };
}

export interface V2FeatureRecord extends ReturnType<typeof createIndexRecord> {
  sourceVideoSHA256: string;
  artifactOrigin: V2ArtifactOrigin;
  reusedFrom: { datasetId: typeof VOCABULARY_ID; sampleId: string; sourceLandmarkSha256: string; tensorSha256: string | null } | null;
}
export interface V2ValidationEvidence {
  sourceIntegrityVerified: boolean;
  unresolvedGenerationErrors: number;
  /** Actual hashes from validated, finite [64,170] physical tensors, keyed by deterministic local path. */
  verifiedTensorSHA256: Record<string, string>;
}

/** Validate composition metadata without performing inference or numerical preprocessing. */
export function summarizeV2Records(records: readonly V2FeatureRecord[], evidence: V2ValidationEvidence) {
  assert.equal(records.length, 22, 'Composite index must represent all 22 recordings');
  assert.equal(new Set(records.map(record => record.sampleId)).size, 22, 'Duplicate composite sample identity');
  assert.equal(new Set(records.map(record => record.sourceVideoSHA256)).size, 22, 'Duplicate composite source content');
  assert.equal(new Set(records.map(record => `${record.sourceCsv}:${record.sourceRow}`)).size, 22, 'Duplicate composite source row');
  assert(Number.isSafeInteger(evidence.unresolvedGenerationErrors) && evidence.unresolvedGenerationErrors >= 0, 'Invalid generation error count');
  for (const record of records) {
    const definition = V2_CLASSES[record.classIndex];
    assert(definition && definition.classId === record.classId, 'Composite class identity differs');
    assert.equal(record.preprocessingVersion, CONTRACT.preprocessingVersion);
    assert.equal(record.featureSchemaVersion, CONTRACT.featureSchemaVersion);
    assert.equal(record.sequenceLength, SEQUENCE_LENGTH); assert.equal(record.featureWidth, FEATURE_WIDTH);
    validateSourceReference(record.sourceCsv, 'metadata');
    assert(Number.isSafeInteger(record.sourceRow) && record.sourceRow >= 2, 'Invalid source row');
    assert(digestPattern.test(record.sourceVideoSHA256), 'Invalid source video hash');
    assert(typeof record.sourceLandmarkSha256 === 'string' && digestPattern.test(record.sourceLandmarkSha256), 'Invalid source landmark hash');
    assert.equal(record.sourceLandmarkRelativePath, `../landmarks-v1/${v2SamplePath(record.sampleId, 'jsonl')}`, 'Unsafe or noncanonical landmark reference');
    for (const key of ['bodyAnchorCoverage', 'anyHandCoverage', 'leftHandCoverage', 'rightHandCoverage', 'poseCoverage', 'faceCoverage'] as const) {
      assert(Number.isFinite(record[key]) && record[key] >= 0 && record[key] <= 1, 'Invalid quality coverage');
    }
    if (record.classIndex < 4) {
      assert.equal(record.artifactOrigin, 'inherited_smoke5_v1');
      assert(record.sampleId.startsWith(`${VOCABULARY_ID}:`), 'Inherited sample identity changed');
      assert(record.reusedFrom, 'Missing inherited artifact provenance');
      assert.equal(record.reusedFrom.datasetId, VOCABULARY_ID);
      assert.equal(record.reusedFrom.sampleId, record.sampleId);
      assert.equal(record.reusedFrom.sourceLandmarkSha256, record.sourceLandmarkSha256, 'Inherited landmark hash differs');
      assert.equal(record.reusedFrom.tensorSha256, record.tensorSha256, 'Inherited tensor hash differs');
    } else {
      assert.equal(record.artifactOrigin, 'derived_smoke5_v2'); assert.equal(record.reusedFrom, null);
      assert(record.sampleId.startsWith(`${V2_ID}:`), 'New sample lacks v2 identity');
      assert(V2_NEW_ROWS.includes(record.sourceRow), 'Unapproved love_like source row');
    }
    assert(record.qualityStatus === 'PASS' || record.qualityStatus === 'FAIL', 'Unknown quality status');
    if (record.qualityStatus === 'PASS') {
      assert.equal(record.tensorRelativePath, v2SamplePath(record.sampleId, 'f32'), 'Unsafe or noncanonical tensor reference');
      assert(typeof record.tensorSha256 === 'string' && digestPattern.test(record.tensorSha256), 'PASS requires a tensor hash');
      assert.equal(evidence.verifiedTensorSHA256[record.tensorRelativePath!], record.tensorSha256, 'PASS tensor physical hash is unverified or differs');
      assert.equal(record.failureReasons.length, 0, 'PASS cannot have failure reasons');
      assert(record.bodyAnchorCoverage >= POLICY.minimumBodyCoverage && record.anyHandCoverage >= POLICY.minimumAnyHandCoverage, 'PASS violates unchanged quality coverage');
      assert(record.sourceDurationSeconds >= POLICY.minimumDurationSeconds && record.sourceDurationSeconds <= POLICY.maximumDurationSeconds, 'PASS violates unchanged duration policy');
    } else {
      assert.equal(record.tensorRelativePath, null, 'FAIL must not have a tensor reference');
      assert.equal(record.tensorSha256, null, 'FAIL must not have a tensor hash');
      assert(record.failureReasons.length > 0, 'FAIL requires an explicit failure reason');
    }
  }
  const perClass = V2_CLASSES.map(definition => {
    const members = records.filter(record => record.classId === definition.classId);
    assert.equal(members.length, definition.expectedRows, 'Composite class recording count differs');
    const pass = members.filter(record => record.qualityStatus === 'PASS').length;
    return { classId: definition.classId, classIndex: definition.classIndex, attempted: members.length, pass, fail: members.length - pass };
  });
  assert.deepEqual(records.filter(record => record.classId === 'love_like').map(record => record.sourceRow).sort((a, b) => a - b), V2_NEW_ROWS, 'Composite love_like source rows differ');
  const pass = perClass.reduce((sum, item) => sum + item.pass, 0);
  assert.deepEqual(Object.keys(evidence.verifiedTensorSHA256).sort(), records.flatMap(record => record.tensorRelativePath ? [record.tensorRelativePath] : []).sort(), 'Unexpected or missing verified tensor');
  const zeroPassClasses = perClass.filter(item => item.pass === 0).map(item => item.classId);
  return {
    datasetId: V2_ID, parentDataset: VOCABULARY_ID, replacement: V2_REPLACEMENT,
    attempted: records.length, pass, fail: records.length - pass, perClass, inheritedArtifactCount: 17, newlyDerivedArtifactCount: 5,
    zeroPassClasses, trainingReady: zeroPassClasses.length === 0 && evidence.sourceIntegrityVerified && evidence.unresolvedGenerationErrors === 0,
  };
}

import assert from 'node:assert/strict';
import { ordinal, sha256 } from './sourceFiles.ts';
import { summarizeV2Records, v2SamplePath, type V2FeatureRecord } from './smokeV2.ts';
import { GLOBAL_SEED, PROTOCOL_POLICY, protocolReadme } from './trainingProtocolPolicy.ts';

export const PROTOCOL_ID = 'smoke5-v2-training-protocol-v1';
export const DATASET_ID = 'mosl-smoke5-v2';
export const FEATURE_DATASET_ID = 'mosl-smoke5-v2-features-v1';
export const CLASS_ORDER = ['good_morning', 'father', 'market', 'gift', 'love_like'] as const;
export const PASS_COUNTS = [3, 2, 3, 2, 4] as const;
export const PROTOCOL_OUTPUTS = ['protocol.json', 'eligible-samples.jsonl', 'folds.json', 'validation.json', 'README.md'] as const;
export type ProtocolOutputName = typeof PROTOCOL_OUTPUTS[number];
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

export interface EligibleSample {
  sampleId: string;
  classId: string;
  classIndex: number;
  sourceCsv: string;
  sourceRow: number;
  tensorRelativePath: string;
  tensorSHA256: string;
  featureDatasetId: typeof FEATURE_DATASET_ID;
  artifactOrigin: V2FeatureRecord['artifactOrigin'];
}
export interface Fold {
  protocolId: typeof PROTOCOL_ID;
  foldId: string;
  foldIndex: number;
  seed: number;
  trainSampleIds: string[];
  testSampleId: string;
  trainClassCounts: { classId: string; classIndex: number; count: number }[];
  testClassId: string;
}
export interface SourceBinding {
  sourceManifestHashes: Record<string, string>;
  sourceIntegritySHA256: Record<string, string>;
  implementationSHA256: Record<string, string>;
}

export function assertSHA256(bytes: string | Buffer, expected: string, name: string): void {
  assert.match(expected, /^[0-9a-f]{64}$/u, `Invalid SHA-256: ${name}`);
  assert.equal(sha256(bytes), expected, `SHA-256 mismatch: ${name}`);
}

export function validateProtocolOutputName(name: string): asserts name is ProtocolOutputName {
  assert(PROTOCOL_OUTPUTS.some(allowed => allowed === name), 'Only the five protocol output names are writable');
}

const compareEligible = (a: EligibleSample, b: EligibleSample): number =>
  a.classIndex - b.classIndex || ordinal(a.sourceCsv, b.sourceCsv) || a.sourceRow - b.sourceRow || ordinal(a.sampleId, b.sampleId);

export function validateEligible(samples: readonly EligibleSample[]): void {
  assert.equal(samples.length, 14, 'Exactly 14 eligible samples required');
  assert.equal(new Set(samples.map(s => s.sampleId)).size, 14, 'Duplicate eligible sample ID');
  assert.equal(new Set(samples.map(s => s.tensorRelativePath)).size, 14, 'Duplicate tensor reference');
  assert.equal(new Set(samples.map(s => `${s.sourceCsv}:${s.sourceRow}`)).size, 14, 'Duplicate source row');
  assert.deepEqual(samples, [...samples].sort(compareEligible), 'Eligible ordering must be classIndex/sourceCsv/sourceRow/sampleId');
  for (const sample of samples) {
    assert.equal(CLASS_ORDER[sample.classIndex], sample.classId, 'Frozen class order differs');
    assert.equal(sample.featureDatasetId, FEATURE_DATASET_ID);
    assert.equal(sample.tensorRelativePath, v2SamplePath(sample.sampleId, 'f32'));
    assert.match(sample.tensorSHA256, /^[0-9a-f]{64}$/u);
    assert.match(sample.sourceCsv, /^metadata\/[^\\\p{Cc}:]+\.csv$/u);
    assert(!sample.sourceCsv.split('/').some(part => part === '.' || part === '..'));
    assert(Number.isSafeInteger(sample.sourceRow) && sample.sourceRow >= 2);
    assert.equal(sample.artifactOrigin, sample.classIndex < 4 ? 'inherited_smoke5_v1' : 'derived_smoke5_v2');
  }
  assert.deepEqual(CLASS_ORDER.map(classId => samples.filter(s => s.classId === classId).length), PASS_COUNTS, 'Eligible class counts differ');
}

export function selectEligible(records: readonly V2FeatureRecord[], verifiedTensorSHA256: Record<string, string>): EligibleSample[] {
  const summary = summarizeV2Records(records, { sourceIntegrityVerified: true, unresolvedGenerationErrors: 0, verifiedTensorSHA256 });
  assert.equal(summary.pass, 14); assert.equal(summary.fail, 8);
  assert.deepEqual(summary.perClass.map(c => c.pass), PASS_COUNTS);
  const samples = records.filter(r => r.qualityStatus === 'PASS').map<EligibleSample>(r => ({
    sampleId: r.sampleId, classId: r.classId, classIndex: r.classIndex,
    sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, tensorRelativePath: r.tensorRelativePath!,
    tensorSHA256: r.tensorSha256!, featureDatasetId: FEATURE_DATASET_ID,
    artifactOrigin: r.artifactOrigin,
  })).sort(compareEligible);
  validateEligible(samples);
  return samples;
}

/** Metadata-only split declarations. This module never loads training/test tensor values. */
export function generateFolds(samples: readonly EligibleSample[]): Fold[] {
  validateEligible(samples);
  return samples.map((heldOut, foldIndex) => {
    const train = samples.filter(sample => sample.sampleId !== heldOut.sampleId);
    return {
      protocolId: PROTOCOL_ID, foldId: `${PROTOCOL_ID}:fold-${String(foldIndex + 1).padStart(2, '0')}`,
      foldIndex, seed: (GLOBAL_SEED + foldIndex) >>> 0,
      trainSampleIds: train.map(sample => sample.sampleId), testSampleId: heldOut.sampleId,
      trainClassCounts: CLASS_ORDER.map((classId, classIndex) => ({ classId, classIndex, count: train.filter(sample => sample.classId === classId).length })),
      testClassId: heldOut.classId,
    };
  });
}

export function validateFolds(samples: readonly EligibleSample[], folds: readonly Fold[]) {
  validateEligible(samples);
  assert.equal(folds.length, 14, 'Exactly 14 folds required');
  assert.equal(new Set(folds.map(f => f.foldId)).size, 14, 'Duplicate fold ID');
  const trainAppearances = new Map(samples.map(s => [s.sampleId, 0]));
  const testAppearances = new Map(samples.map(s => [s.sampleId, 0]));
  for (const [index, fold] of folds.entries()) {
    assert.equal(fold.protocolId, PROTOCOL_ID);
    assert.equal(fold.foldIndex, index);
    assert.equal(fold.foldId, `${PROTOCOL_ID}:fold-${String(index + 1).padStart(2, '0')}`);
    assert.equal(fold.seed, (GLOBAL_SEED + index) >>> 0);
    assert.equal(fold.testSampleId, samples[index].sampleId, 'Fold order/test identity differs');
    assert.equal(fold.testClassId, samples[index].classId);
    assert.equal(fold.trainSampleIds.length, 13, 'Each fold requires 13 train samples');
    assert.equal(new Set(fold.trainSampleIds).size, 13, 'Duplicate training sample');
    assert(!fold.trainSampleIds.includes(fold.testSampleId), 'TRAIN/TEST overlap');
    const train = samples.filter(s => s.sampleId !== fold.testSampleId);
    assert.deepEqual(fold.trainSampleIds, train.map(s => s.sampleId), 'Missing, reordered or unapproved training sample');
    const counts = CLASS_ORDER.map((classId, classIndex) => ({ classId, classIndex, count: train.filter(s => s.classId === classId).length }));
    assert.deepEqual(fold.trainClassCounts, counts);
    assert(counts.every(c => c.count >= 1), 'A class has no training support');
    for (const id of fold.trainSampleIds) trainAppearances.set(id, trainAppearances.get(id)! + 1);
    testAppearances.set(fold.testSampleId, testAppearances.get(fold.testSampleId)! + 1);
  }
  assert([...trainAppearances.values()].every(count => count === 13));
  assert([...testAppearances.values()].every(count => count === 1));
  return {
    foldCount: folds.length, trainCountPerFold: 13, testCountPerFold: 1,
    trainTestOverlap: false, allFiveClassesPresentInEveryTrainingFold: true,
    sampleCoverage: samples.map(s => ({ sampleId: s.sampleId, trainAppearances: trainAppearances.get(s.sampleId), testAppearances: testAppearances.get(s.sampleId) })),
  };
}

function orderedHashes(hashes: Record<string, string>): Record<string, string> {
  assert(Object.keys(hashes).length > 0, 'Missing source/hash binding');
  return Object.fromEntries(Object.keys(hashes).sort(ordinal).map(name => {
    assert(!/[\\:\p{Cc}]/u.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe hash reference');
    assert.match(hashes[name], /^[0-9a-f]{64}$/u);
    return [name, hashes[name]];
  }));
}

export function buildProtocolArtifacts(samples: readonly EligibleSample[], binding: SourceBinding) {
  validateEligible(samples);
  assert.deepEqual(PROTOCOL_POLICY.classOrder, CLASS_ORDER);
  for (const [name, digest] of Object.entries({ ...binding.sourceManifestHashes, ...binding.implementationSHA256 })) {
    assert.equal(binding.sourceIntegritySHA256[name], digest, `Hash binding differs or is missing: ${name}`);
  }
  const folds = generateFolds(samples);
  const coverage = validateFolds(samples, folds);
  const eligibleText = samples.map(sample => JSON.stringify(sample)).join('\n') + '\n';
  const foldsText = json({ protocolId: PROTOCOL_ID, foldOrdering: 'eligible-samples.jsonl line order', folds });
  const protocol = {
    protocolId: PROTOCOL_ID, ...PROTOCOL_POLICY,
    datasetId: DATASET_ID, featureDatasetId: FEATURE_DATASET_ID, vocabularyId: DATASET_ID,
    eligibleSampleCount: 14, excludedQualityFailCount: 8,
    featureDatasetRelativeRoot: 'data/scope5/derived/mosl-v1/smoke5-v2/features-v1',
    tensor: { shape: [64, 170], dtype: 'float32', serialization: 'raw-headerless-row-major-f32', byteOrder: 'little-endian', bytes: 43520 },
    preprocessing: { version: 'sign-features-170-v1', featureLayout: 'anatomical-170-v1', temporalResampling: 'uniform64-adjacent-supported-v1', qualityPolicy: 'supported-time-85body-70hand-v1' },
    eligibleOrdering: 'classIndex ascending, sourceCsv UTF-16 ordinal, sourceRow ascending, sampleId UTF-16 ordinal; no Unicode normalization',
    sourceManifestHashes: orderedHashes(binding.sourceManifestHashes),
    sourceIntegritySHA256: orderedHashes(binding.sourceIntegritySHA256),
    implementationSHA256: orderedHashes(binding.implementationSHA256),
    artifacts: {
      eligible: { relativePath: 'eligible-samples.jsonl', sha256: sha256(eligibleText) },
      folds: { relativePath: 'folds.json', sha256: sha256(foldsText) },
    },
    versioning: 'Write-once bytes; any change to eligibility, source hashes, folds or rules requires a new protocol identity/version. Hashes bind content, not authorship.',
  };
  const protocolText = json(protocol), protocolSHA256 = sha256(protocolText);
  const readme = protocolReadme({ protocolId: PROTOCOL_ID, protocolSHA256, eligibleSHA256: sha256(eligibleText), foldsSHA256: sha256(foldsText) });
  const validation = {
    protocolId: PROTOCOL_ID, status: 'VERIFIED', readyForImplementation: true,
    datasetIntegrity: 'SOURCE_MANIFESTS_AND_REFERENCED_FILES_SHA256_VERIFIED',
    eligibleCount: 14, excludedQualityFailCount: 8,
    classCounts: CLASS_ORDER.map((classId, classIndex) => ({ classId, classIndex, count: PASS_COUNTS[classIndex] })),
    ...coverage, classOrderVerified: true, tensorHashVerifiedCount: 14, finiteFloat32TensorCount: 14,
    tensorBytes: 43520, failSamplesAbsentFromFolds: true, failSamplesHaveNoTensor: true,
    protectedFileCount: Object.keys(binding.sourceIntegritySHA256).length,
    sourceFilesUnchanged: true, privateOutputsGitIgnored: true,
    deterministicGeneration: true, modelsFitted: 0, predictionsCreated: 0,
    artifactSHA256: { 'protocol.json': protocolSHA256, 'eligible-samples.jsonl': sha256(eligibleText), 'folds.json': sha256(foldsText), 'README.md': sha256(readme) },
  };
  const files: Record<ProtocolOutputName, string> = {
    'protocol.json': protocolText, 'eligible-samples.jsonl': eligibleText,
    'folds.json': foldsText, 'validation.json': json(validation), 'README.md': readme,
  };
  return { files, protocol, validation, folds, eligible: samples };
}

/** Compare frozen bytes against current verified inputs; never silently regenerate another v1. */
export function verifyFrozenProtocol(actual: Record<ProtocolOutputName, string>, expected: ReturnType<typeof buildProtocolArtifacts>): void {
  for (const name of PROTOCOL_OUTPUTS) assert.equal(actual[name], expected.files[name], `Frozen protocol differs: ${name}; use a new version`);
  const metadata = JSON.parse(actual['protocol.json']) as { artifacts: { eligible: { sha256: string }; folds: { sha256: string } } };
  assertSHA256(actual['eligible-samples.jsonl'], metadata.artifacts.eligible.sha256, 'eligible samples');
  assertSHA256(actual['folds.json'], metadata.artifacts.folds.sha256, 'fold definitions');
}

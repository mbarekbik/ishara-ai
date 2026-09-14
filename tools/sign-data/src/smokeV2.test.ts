import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT } from '../../../shared/sign-preprocessing/schema.ts';
import type { AuditCurationRecord, CurationEvidence } from './curation.ts';
import { buildSmokeCuration, CURATION_OUTPUT_NAMES, SMOKE_CLASSES, VOCABULARY_ID } from './curation.ts';
import type { ExtractionSample } from './extractionModel.ts';
import { EXPECTED, sha256 } from './sourceFiles.ts';
import type { V2CurationEvidence, V2FeatureRecord, V2ParentVocabulary, V2ValidationEvidence } from './smokeV2.ts';
import { buildV2Curation, summarizeV2Records, V2_CLASSES, V2_ID, V2_NEW_ROWS, v2SamplePath } from './smokeV2.ts';

const historicalEvidence: CurationEvidence = {
  auditSummarySHA256: 'a'.repeat(64), auditInventorySHA256: 'b'.repeat(64), auditChecksumsSHA256: 'c'.repeat(64),
  videosSHA256: EXPECTED.videoDigest, videosAndCsvSHA256: EXPECTED.datasetDigest,
  sourceFilesVerified: 2221, readabilityEvidence: 'prior-full-decode-with-identical-source-hashes',
};

function auditRecord(definition: typeof SMOKE_CLASSES[number], row: number): AuditCurationRecord {
  return {
    sourceCsv: 'metadata/synthetic.csv', sourceRow: row, category: 'synthetic',
    metadataFilePath: `/original/${row}.mp4`, metadataFilename: `${row}.mp4`, localVideoRelativePath: `videos/synthetic/${row}.mp4`,
    rawSignLabel: definition.rawSourceLabel, englishGloss: definition.displayEn, declaredSignerId: `signer_${definition.classIndex}`,
    sha256: sha256(`synthetic-video-${row}`), durationMetadata: 2, durationActual: 2, frameRateMetadata: 25, frameRateActual: 25,
    frameCountMetadata: 50, frameCountActual: 50, resolutionMetadata: { width: 460, height: 460 }, resolutionActual: { width: 460, height: 460 },
    fileSizeMetadata: 10000, fileSizeActual: 10000, matchStatus: 'EXACT', matchReason: 'Synthetic exact audit mapping',
    contentDuplicateGroupId: null, mediaComparison: { supportsAssociation: true, differences: [] }, usableForLaterCuration: true,
    reviewReasons: ['DECLARED_SIGNER_ID_UNVERIFIED', 'LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED'],
  };
}

function fixture() {
  let row = 1;
  const parentRecords = SMOKE_CLASSES.flatMap(definition => Array.from({ length: definition.expectedRows }, () => auditRecord(definition, ++row)));
  const parentOutputs = buildSmokeCuration(parentRecords, historicalEvidence);
  const vocabulary = JSON.parse(parentOutputs['vocabulary.json']) as V2ParentVocabulary;
  vocabulary.classes[0].preservedAdditionalDefinition = { marker: 'unchanged' };
  const samples = parentOutputs['samples.jsonl'].trimEnd().split('\n').map(line => JSON.parse(line) as ExtractionSample);
  const newRecords = V2_NEW_ROWS.map(sourceRow => auditRecord(V2_CLASSES[4], sourceRow));
  const records = [...parentRecords, ...newRecords];
  const evidence: V2CurationEvidence = {
    ...historicalEvidence,
    parentCurationSHA256: Object.fromEntries(CURATION_OUTPUT_NAMES.map(name => [name, sha256(parentOutputs[name])])),
    verifiedNewSources: newRecords.map(record => ({ sourceCsv: record.sourceCsv, sourceRow: record.sourceRow, localVideoRelativePath: record.localVideoRelativePath, sha256: record.sha256, size: record.fileSizeActual! })),
  };
  return { vocabulary, samples, records, evidence };
}

function curate(data = fixture()) {
  return buildV2Curation(data.vocabulary, data.samples, data.records, data.evidence);
}

function featureFixture() {
  const curated = curate();
  const records: V2FeatureRecord[] = curated.samples.map((sample, position) => {
    const sourceLandmarkSha256 = sha256(`synthetic-landmarks-${position}`);
    const passed = sample.classId === 'love_like' ? sample.sourceRow !== 1664 : position !== 0 && position !== 4 && position !== 5 && position !== 9 && position !== 10 && position !== 14 && position !== 15;
    const tensorSha256 = passed ? sha256(`synthetic-tensor-${position}`) : null;
    return {
      sampleId: sample.sampleId, classId: sample.classId, classIndex: sample.classIndex, sourceCsv: sample.sourceCsv, sourceRow: sample.sourceRow,
      declaredSignerId: sample.declaredSignerId, sourceVideoSHA256: sample.sha256,
      sourceLandmarkRelativePath: `../landmarks-v1/${v2SamplePath(sample.sampleId, 'jsonl')}`, sourceLandmarkSha256,
      preprocessingVersion: CONTRACT.preprocessingVersion, featureSchemaVersion: CONTRACT.featureSchemaVersion,
      sequenceLength: 64, featureWidth: 170, tensorRelativePath: passed ? v2SamplePath(sample.sampleId, 'f32') : null, tensorSha256,
      qualityStatus: passed ? 'PASS' : 'FAIL', bodyAnchorCoverage: 1, anyHandCoverage: passed ? 0.9 : 0.5,
      leftHandCoverage: passed ? 0.9 : 0.5, rightHandCoverage: 0.4, poseCoverage: 1, faceCoverage: 1,
      sourceDurationSeconds: 2, preprocessingWarnings: [], failureReasons: passed ? [] : ['ANY_HAND_COVERAGE_BELOW_MINIMUM'],
      artifactOrigin: sample.artifactOrigin,
      reusedFrom: sample.reusedFrom ? { ...sample.reusedFrom, sourceLandmarkSha256, tensorSha256 } : null,
    };
  });
  const evidence: V2ValidationEvidence = { sourceIntegrityVerified: true, unresolvedGenerationErrors: 0,
    verifiedTensorSHA256: Object.fromEntries(records.flatMap(record => record.tensorRelativePath ? [[record.tensorRelativePath, record.tensorSha256!]] : [])),
  };
  return { records, evidence };
}

test('v2 freezes five classes and preserves all first-four definitions and seventeen inherited identities without mutation', () => {
  const data = fixture();
  const before = structuredClone(data);
  const result = curate(data);
  assert.deepEqual(result.vocabulary.classes.map(value => [value.classIndex, value.classId]), [[0, 'good_morning'], [1, 'father'], [2, 'market'], [3, 'gift'], [4, 'love_like']]);
  assert.deepEqual(result.vocabulary.classes.slice(0, 4), data.vocabulary.classes.slice(0, 4));
  assert.deepEqual(result.vocabulary.classes[4], { classIndex: 4, classId: 'love_like', rawSourceLabel: 'أَحَبَّ', displayEn: 'Love / Like', displayAr: 'أَحَبَّ', linguisticReviewStatus: 'unverified', enabledForEngineeringSmokeTest: true });
  assert.equal(result.vocabulary.vocabularyId, V2_ID);
  assert.equal(result.vocabulary.parentDataset, VOCABULARY_ID);
  assert.deepEqual(result.samples.slice(0, 17).map(({ artifactOrigin, reusedFrom, ...sample }) => {
    assert.equal(artifactOrigin, 'inherited_smoke5_v1'); assert.equal(reusedFrom?.sampleId, sample.sampleId);
    assert.equal(reusedFrom?.datasetId, VOCABULARY_ID); return sample;
  }), data.samples.slice(0, 17));
  assert(result.samples.every(sample => sample.classId !== 'police_officer'));
  assert.equal(result.exclusions.omittedParentSamples.length, 4);
  assert.equal(result.samples.length, 22);
  assert.deepEqual(result.coverage.classes.map(value => value.candidateRecordCount), [4, 5, 5, 3, 5]);
  assert.deepEqual(data, before);
  result.samples[0].resolution.width = 1;
  assert.deepEqual(data, before, 'Output cannot alias mutable parent source objects');
});

test('only new rows use v2 identity tuple and curation artifacts are deterministic with auditable hashes', () => {
  const data = fixture(); const result = curate(data);
  assert.deepEqual(result, buildV2Curation(data.vocabulary, data.samples, [...data.records].reverse(), data.evidence));
  for (const sample of result.samples.slice(17)) {
    assert.equal(sample.sampleId, `${V2_ID}:${sha256(JSON.stringify([V2_ID, sample.sourceCsv, sample.sourceRow, sample.localVideoRelativePath]))}`);
    assert.equal(sample.artifactOrigin, 'derived_smoke5_v2'); assert.equal(sample.reusedFrom, null);
    assert.equal(sample.sourceEnglishGloss, 'Love / Like');
  }
  assert.deepEqual(result.samples.slice(17).map(sample => sample.sourceRow), V2_NEW_ROWS);
  for (const [name, hash] of Object.entries(result.coverage.artifactSHA256)) assert.equal(sha256(result.outputs[name as keyof typeof result.outputs]), hash);
  assert.match(result.review, /byte-for-byte/u); assert.match(result.review, /Only love_like is newly derived/u);
});

test('approved source rows reject normalized labels, gloss reinterpretation, missing rows and mutated parent identities', () => {
  const mutations: Array<(data: ReturnType<typeof fixture>) => void> = [
    data => { data.records[21].rawSignLabel = data.records[21].rawSignLabel.normalize('NFC'); },
    data => { data.records[21].englishGloss = 'I love you'; },
    data => { data.records.pop(); },
    data => { data.records[21].sourceRow = 1665; },
    data => { data.samples[0].sampleId = `${V2_ID}:${'1'.repeat(64)}`; },
    data => { data.samples[0].classIndex = 1; },
    data => { data.vocabulary.classes[0].displayEn = 'Changed'; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => curate(data)); }
});

test('new source acceptance rejects ambiguity, suspicious metadata, media discrepancies and physical hash mismatches', () => {
  const mutations: Array<(data: ReturnType<typeof fixture>) => void> = [
    data => { data.records[21].matchStatus = 'AMBIGUOUS'; },
    data => { data.records[21].reviewReasons.push('COMBINING_MARK_ONLY_LABEL'); },
    data => { data.records[21].usableForLaterCuration = false; },
    data => { data.records[21].frameCountActual = 99; },
    data => { data.records[21].mediaComparison = { supportsAssociation: false, differences: [] }; },
    data => { data.evidence.verifiedNewSources[0].sha256 = '0'.repeat(64); },
    data => { data.evidence.verifiedNewSources[0].size++; },
    data => { data.evidence.verifiedNewSources.pop(); },
    data => { data.evidence.parentCurationSHA256['samples.jsonl'] = ''; },
    data => { data.records[21].localVideoRelativePath = 'videos/../private.mp4'; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => curate(data)); }
});

test('repeated audit rows and same-label or cross-label content cannot inflate v2 recording counts', () => {
  const mutations: Array<(data: ReturnType<typeof fixture>) => void> = [
    data => { data.records.push(structuredClone(data.records[21])); },
    data => { data.records[22].sha256 = data.records[21].sha256; },
    data => { data.records[21].sha256 = data.samples[0].sha256; },
    data => { data.records.push({ ...data.records[21], sourceRow: 9999, rawSignLabel: 'another-label' }); },
    data => { data.records[21].contentDuplicateGroupId = `sha256:${data.records[21].sha256}`; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => curate(data)); }
});

test('cross-version names permit only exact v1 or v2 identities and canonical artifact extensions', () => {
  for (const version of [1, 2]) {
    const id = `mosl-smoke5-v${version}:${'f'.repeat(64)}`;
    for (const extension of ['jsonl', 'f32'] as const) assert.equal(v2SamplePath(id, extension), `samples/mosl-smoke5-v${version}%3A${'f'.repeat(64)}.${extension}`);
  }
  for (const id of ['../source/video.mp4', 'C:\\private\\file', `mosl-smoke5-v3:${'f'.repeat(64)}`, `mosl-smoke5-v2:${'f'.repeat(64)}:stream`, `mosl-smoke5-v2%3A${'f'.repeat(64)}`, `mosl-smoke5-v2:${'f'.repeat(64)}/../x`]) assert.throws(() => v2SamplePath(id, 'f32'));
});

test('composite summary accounts for every recording, inherited hash equality and real per-class PASS outcomes', () => {
  const data = featureFixture(); const before = structuredClone(data);
  const summary = summarizeV2Records(data.records, data.evidence);
  assert.deepEqual(summary.perClass.map(item => item.pass), [3, 3, 3, 1, 4]);
  assert.equal(summary.attempted, 22); assert.equal(summary.pass, 14); assert.equal(summary.fail, 8);
  assert.equal(summary.inheritedArtifactCount, 17); assert.equal(summary.newlyDerivedArtifactCount, 5);
  assert.equal(summary.trainingReady, true); assert.deepEqual(data, before);
  const bad = structuredClone(data); bad.records[1].reusedFrom!.tensorSha256 = '0'.repeat(64);
  assert.throws(() => summarizeV2Records(bad.records, bad.evidence), /Inherited tensor hash differs/u);
});

test('composition rejects missing or repeated records, class changes, invalid artifact provenance and unsafe paths', () => {
  const mutations: Array<(data: ReturnType<typeof featureFixture>) => void> = [
    data => { data.records.pop(); },
    data => { data.records[1] = data.records[0]; },
    data => { data.records[0].classId = 'police_officer'; },
    data => { data.records[0].classIndex = 4; },
    data => { data.records[0].reusedFrom = null; },
    data => { data.records[0].sourceLandmarkRelativePath = '../../smoke5-v1/manifest.json'; },
    data => { data.records[1].tensorRelativePath = 'samples/../../source/video.mp4'; },
    data => { data.records[17].artifactOrigin = 'inherited_smoke5_v1'; },
    data => { data.records[17].sourceRow = 9999; },
  ];
  for (const mutate of mutations) { const data = featureFixture(); mutate(data); assert.throws(() => summarizeV2Records(data.records, data.evidence)); }
});

test('PASS needs a verified hash and unchanged quality; FAIL needs a reason and never receives a tensor', () => {
  const mutations: Array<(data: ReturnType<typeof featureFixture>) => void> = [
    data => { data.records[1].tensorSha256 = null; },
    data => { delete data.evidence.verifiedTensorSHA256[data.records[1].tensorRelativePath!]; },
    data => { data.evidence.verifiedTensorSHA256[data.records[1].tensorRelativePath!] = '0'.repeat(64); },
    data => { data.records[1].anyHandCoverage = 0.6; },
    data => { data.records[1].sourceDurationSeconds = 0.5; },
    data => { data.records[0].tensorRelativePath = v2SamplePath(data.records[0].sampleId, 'f32'); },
    data => { data.records[0].failureReasons = []; },
    data => { data.records[1].failureReasons = ['failure']; },
  ];
  for (const mutate of mutations) { const data = featureFixture(); mutate(data); assert.throws(() => summarizeV2Records(data.records, data.evidence)); }
});

test('zero-PASS classes and unresolved integrity or generation errors block training readiness', () => {
  const data = featureFixture();
  for (const record of data.records.filter(record => record.classId === 'love_like')) {
    if (record.tensorRelativePath) delete data.evidence.verifiedTensorSHA256[record.tensorRelativePath];
    record.qualityStatus = 'FAIL'; record.tensorRelativePath = null; record.tensorSha256 = null;
    record.anyHandCoverage = 0.5; record.failureReasons = ['ANY_HAND_COVERAGE_BELOW_MINIMUM'];
  }
  const summary = summarizeV2Records(data.records, data.evidence);
  assert.deepEqual(summary.zeroPassClasses, ['love_like']); assert.equal(summary.trainingReady, false);
  const valid = featureFixture();
  assert.equal(summarizeV2Records(valid.records, { ...valid.evidence, sourceIntegrityVerified: false }).trainingReady, false);
  assert.equal(summarizeV2Records(valid.records, { ...valid.evidence, unresolvedGenerationErrors: 1 }).trainingReady, false);
});

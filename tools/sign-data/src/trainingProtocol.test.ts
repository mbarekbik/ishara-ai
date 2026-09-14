import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT } from '../../../shared/sign-preprocessing/schema.ts';
import { sha256 } from './sourceFiles.ts';
import { V2_NEW_ROWS, v2SamplePath, type V2FeatureRecord } from './smokeV2.ts';
import { GLOBAL_SEED, PROTOCOL_POLICY } from './trainingProtocolPolicy.ts';
import { assertSHA256, buildProtocolArtifacts, CLASS_ORDER, FEATURE_DATASET_ID, generateFolds, PASS_COUNTS, PROTOCOL_OUTPUTS, selectEligible, validateEligible, validateFolds, validateProtocolOutputName, verifyFrozenProtocol, type SourceBinding } from './trainingProtocol.ts';
import { protocolOutputPath } from './trainingProtocolFiles.ts';

function fixture() {
  let number = 0;
  const records: V2FeatureRecord[] = CLASS_ORDER.flatMap((classId, classIndex) =>
    Array.from({ length: [4, 5, 5, 3, 5][classIndex] }, (_, withinClass) => {
      number++;
      const sampleId = `mosl-smoke5-v${classIndex < 4 ? 1 : 2}:${sha256(`synthetic-sample-${number}`)}`;
      const passed = withinClass < PASS_COUNTS[classIndex];
      const sourceLandmarkSha256 = sha256(`synthetic-landmarks-${number}`);
      const tensorSha256 = passed ? sha256(`synthetic-tensor-${number}`) : null;
      return {
        sampleId, classId, classIndex, sourceCsv: 'metadata/synthetic.csv',
        sourceRow: classIndex === 4 ? V2_NEW_ROWS[withinClass] : number + 1,
        declaredSignerId: `unverified_${classIndex}`, sourceVideoSHA256: sha256(`synthetic-video-${number}`),
        sourceLandmarkRelativePath: `../landmarks-v1/${v2SamplePath(sampleId, 'jsonl')}`, sourceLandmarkSha256,
        preprocessingVersion: CONTRACT.preprocessingVersion, featureSchemaVersion: CONTRACT.featureSchemaVersion,
        sequenceLength: 64, featureWidth: 170, tensorRelativePath: passed ? v2SamplePath(sampleId, 'f32') : null,
        tensorSha256, qualityStatus: passed ? 'PASS' : 'FAIL',
        bodyAnchorCoverage: 1, anyHandCoverage: passed ? 0.9 : 0.5, leftHandCoverage: 0.5,
        rightHandCoverage: 0.5, poseCoverage: 1, faceCoverage: 1, sourceDurationSeconds: 2,
        preprocessingWarnings: [], failureReasons: passed ? [] : ['ANY_HAND_COVERAGE_BELOW_MINIMUM'],
        artifactOrigin: classIndex < 4 ? 'inherited_smoke5_v1' : 'derived_smoke5_v2',
        reusedFrom: classIndex < 4 ? { datasetId: 'mosl-smoke5-v1', sampleId, sourceLandmarkSha256, tensorSha256 } : null,
      };
    }));
  const tensors = Object.fromEntries(records.flatMap(r => r.tensorRelativePath ? [[r.tensorRelativePath, r.tensorSha256!]] : []));
  const eligible = selectEligible(records, tensors);
  const manifestHash = sha256('synthetic manifest'), implementationHash = sha256('synthetic implementation');
  const binding: SourceBinding = {
    sourceManifestHashes: { 'data/synthetic/manifest.json': manifestHash },
    sourceIntegritySHA256: { 'data/synthetic/manifest.json': manifestHash, 'tools/synthetic.ts': implementationHash },
    implementationSHA256: { 'tools/synthetic.ts': implementationHash },
  };
  return { records, tensors, eligible, binding };
}

test('eligibility freezes 14 PASS samples and excludes all eight FAIL records with exact class support', () => {
  const { records, eligible } = fixture();
  assert.equal(records.length, 22); assert.equal(eligible.length, 14);
  assert.equal(records.filter(r => r.qualityStatus === 'FAIL').length, 8);
  assert.deepEqual(CLASS_ORDER.map(id => eligible.filter(s => s.classId === id).length), [3, 2, 3, 2, 4]);
  assert(eligible.every(s => s.featureDatasetId === FEATURE_DATASET_ID));
  assert(records.filter(r => r.qualityStatus === 'FAIL').every(r => !eligible.some(s => s.sampleId === r.sampleId)));
});

test('LOOCV has fourteen 13+1 folds, no overlap, full class support and exact sample appearances', () => {
  const { eligible } = fixture(); const folds = generateFolds(eligible);
  const validation = validateFolds(eligible, folds);
  assert.equal(folds.length, 14);
  assert(validation.sampleCoverage.every(s => s.testAppearances === 1 && s.trainAppearances === 13));
  assert(folds.every(f => f.trainSampleIds.length === 13 && !f.trainSampleIds.includes(f.testSampleId)));
  assert(folds.every(f => f.trainClassCounts.length === 5 && f.trainClassCounts.every(c => c.count >= 1)));
  assert.deepEqual(folds.map(f => f.seed), Array.from({ length: 14 }, (_, i) => GLOBAL_SEED + i));
});

test('eligible/fold ordering is independent of source record iteration and inputs are not mutated', () => {
  const { records, tensors, eligible } = fixture(); const before = structuredClone(records);
  const reordered = selectEligible([...records].reverse(), tensors);
  assert.deepEqual(reordered, eligible); assert.deepEqual(generateFolds(reordered), generateFolds(eligible));
  assert.deepEqual(records, before);
});

test('duplicate sample IDs, missing attempts, changed class index and an unknown class reject eligibility', () => {
  const mutations: Array<(rows: V2FeatureRecord[]) => void> = [
    rows => { rows[1] = structuredClone(rows[0]); }, rows => { rows.pop(); },
    rows => { rows[0].classIndex = 1; }, rows => { rows[0].classId = 'police_officer'; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data.records); assert.throws(() => selectEligible(data.records, data.tensors)); }
});

test('unverified or changed tensor hashes reject the eligible set', () => {
  const data = fixture(); const first = data.eligible[0].tensorRelativePath;
  delete data.tensors[first]; assert.throws(() => selectEligible(data.records, data.tensors));
  data.tensors[first] = sha256('different tensor'); assert.throws(() => selectEligible(data.records, data.tensors));
});

test('a FAIL cannot acquire a tensor or enter the protocol by silently changing eligibility', () => {
  const data = fixture(); const fail = data.records.find(r => r.qualityStatus === 'FAIL')!;
  fail.tensorRelativePath = v2SamplePath(fail.sampleId, 'f32'); fail.tensorSha256 = sha256('forbidden');
  assert.throws(() => selectEligible(data.records, data.tensors));
  fail.qualityStatus = 'PASS'; fail.failureReasons = []; fail.anyHandCoverage = 1;
  if (fail.reusedFrom) fail.reusedFrom.tensorSha256 = fail.tensorSha256;
  data.tensors[fail.tensorRelativePath] = fail.tensorSha256;
  assert.throws(() => selectEligible(data.records, data.tensors));
});

test('eligible ordering, tensor paths and duplicate references are validated', () => {
  const { eligible } = fixture();
  assert.throws(() => validateEligible([...eligible].reverse()));
  for (const path of ['../raw.mp4', 'samples/../../x.f32', 'C:/secret', 'samples/x.f32']) {
    const changed = structuredClone(eligible); changed[0].tensorRelativePath = path; assert.throws(() => validateEligible(changed));
  }
  const duplicate = structuredClone(eligible); duplicate[1] = duplicate[0]; assert.throws(() => validateEligible(duplicate));
});

test('malformed folds reject overlap, duplicates, omission, wrong order and false training support', () => {
  const { eligible } = fixture();
  const mutations: Array<(folds: ReturnType<typeof generateFolds>) => void> = [
    folds => { folds.pop(); }, folds => { folds[0].trainSampleIds[0] = folds[0].testSampleId; },
    folds => { folds[0].trainSampleIds[1] = folds[0].trainSampleIds[0]; },
    folds => { folds[1].testSampleId = folds[0].testSampleId; }, folds => { folds.reverse(); },
    folds => { folds[0].trainClassCounts[0].count = 0; }, folds => { folds[0].trainSampleIds.pop(); },
  ];
  for (const mutate of mutations) { const folds = generateFolds(eligible); mutate(folds); assert.throws(() => validateFolds(eligible, folds)); }
});

test('all protocol artifacts regenerate byte-identically with hashes and no model metrics', () => {
  const { eligible, binding } = fixture(); const first = buildProtocolArtifacts(eligible, binding);
  const second = buildProtocolArtifacts(eligible, { ...binding, sourceIntegritySHA256: Object.fromEntries(Object.entries(binding.sourceIntegritySHA256).reverse()) });
  assert.deepEqual(first.files, second.files); assert.deepEqual(Object.keys(first.files).sort(), [...PROTOCOL_OUTPUTS].sort());
  assert.equal(first.validation.modelsFitted, 0); assert.equal(first.validation.predictionsCreated, 0);
  for (const [name, digest] of Object.entries(first.validation.artifactSHA256)) assert.equal(sha256(first.files[name as keyof typeof first.files]), digest);
  verifyFrozenProtocol(first.files, second);
  assert(!Object.hasOwn(first.validation, 'accuracy')); assert(!Object.hasOwn(first.validation, 'predictions'));
});

test('source digest checks reject changed bytes and invalid or conflicting source bindings', () => {
  assertSHA256('source', sha256('source'), 'fixture');
  assert.throws(() => assertSHA256('changed', sha256('source'), 'fixture'), /SHA-256 mismatch/);
  assert.throws(() => assertSHA256('source', 'invalid', 'fixture'));
  const { eligible, binding } = fixture(); binding.sourceManifestHashes['data/synthetic/manifest.json'] = sha256('changed');
  assert.throws(() => buildProtocolArtifacts(eligible, binding), /Hash binding differs/);
});

test('a changed eligible dataset cannot validate under an already frozen protocol', () => {
  const { eligible, binding } = fixture(); const frozen = buildProtocolArtifacts(eligible, binding);
  const changed = structuredClone(eligible); changed[0].tensorSHA256 = sha256('different accepted bytes');
  const recomposed = buildProtocolArtifacts(changed, binding);
  assert.throws(() => verifyFrozenProtocol(frozen.files, recomposed), /Frozen protocol differs/);
  const tampered = { ...frozen.files, 'folds.json': frozen.files['folds.json'].replace('fold-01', 'fold-99') };
  assert.throws(() => verifyFrozenProtocol(tampered, frozen));
});

test('only the five private protocol filenames are writable, never source or runtime paths', () => {
  for (const name of PROTOCOL_OUTPUTS) { validateProtocolOutputName(name); assert.match(protocolOutputPath(name), /protocol-v1[\\/]/u); }
  for (const name of ['../features-v1/manifest.json', '../source/raw.mp4', '/tmp/x', 'C:\\x', 'protocol.json:stream', 'protocol.json.pending', 'samples/x.f32', 'model.onnx']) {
    assert.throws(() => protocolOutputPath(name));
  }
});

test('frozen policy preserves held-out separation, unreviewed data limits and future-only experiments', () => {
  assert(Object.isFrozen(PROTOCOL_POLICY)); assert(Object.isFrozen(PROTOCOL_POLICY.leakagePolicy));
  assert.equal(PROTOCOL_POLICY.leakagePolicy.testIsValidation, false);
  assert.equal(PROTOCOL_POLICY.leakagePolicy.earlyStopping, false);
  assert.equal(PROTOCOL_POLICY.augmentation, 'none'); assert.equal(PROTOCOL_POLICY.unknownClass, false);
  assert.equal(PROTOCOL_POLICY.scalerPolicy.additionalDatasetFittedScaler, 'none');
  assert.equal(PROTOCOL_POLICY.futureExperiments.baseline.experimentId, 'baseline-v1');
  assert.equal(PROTOCOL_POLICY.futureExperiments.executionAuthorizedByThisFreeze, false);
  const { eligible, binding } = fixture(); const readme = buildProtocolArtifacts(eligible, binding).files['README.md'];
  assert.match(readme, /LOOCV does not solve the signer problem/u); assert.match(readme, /TEST != VALIDATION/u);
  assert.match(readme, /no independent test result/u); assert.match(readme, /No random 80\/20/u);
});

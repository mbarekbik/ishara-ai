import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeTensor, serializeTensor, tensorOutputPath, TENSOR_BYTES, validateFeatureOutputName, validateExtractionCompatibility, createIndexRecord, createFeatureArtifacts, processVerifiedSequence } from './featureFiles.ts';
import type { FeatureAttempt, FeatureInputs } from './featureFiles.ts';
import type { ExtractionSample } from './extractionModel.ts';
import type { ExtractionResult } from './extractionFiles.ts';
import { sha256 } from './sourceFiles.ts';
import { SMOKE_CLASSES } from './curation.ts';
import { goldenSequence } from './preprocessingFixtures.ts';
import { preprocessSequence } from '../../../shared/sign-preprocessing/preprocess.ts';

function fixture(): FeatureInputs {
  let ordinal = 0;
  const samples = SMOKE_CLASSES.flatMap(definition => Array.from({ length: definition.expectedRows }, () => {
    ordinal++;
    return { sampleId: `mosl-smoke5-v1:${ordinal.toString(16).padStart(64, '0')}`, classId: definition.classId, classIndex: definition.classIndex,
      rawSourceLabel: definition.rawSourceLabel, sourceCsv: 'metadata/synthetic.csv', sourceRow: ordinal + 1, declaredSignerId: 'synthetic-signer',
      localVideoRelativePath: `videos/synthetic/${ordinal}.mp4`, sha256: 'a'.repeat(64), duration: 5, resolution: { width: 200, height: 100 } } as ExtractionSample;
  }));
  const results = samples.map((sample, index) => {
    const count = index === 20 ? 52 : 44;
    return { ...sample, sourceVideoRelativePath: sample.localVideoRelativePath, sourceVideoSHA256: sample.sha256,
      sourceDurationSeconds: sample.duration, sourceDimensions: sample.resolution, status: 'success', delegate: 'GPU', error: null,
      outputRelativePath: tensorOutputPath(sample.sampleId).replace('.f32', '.jsonl'), outputSHA256: 'b'.repeat(64),
      extractedLandmarkFrameCount: count, selectedSourceFrames: Array.from({ length: count }, (_, i) => ({ index: i, timestampMs: i * 80 })),
      decodedSourceFrameCount: count, sourceTimeBase: '1/1000', mediaStartMs: 0, mediaEndMs: (count - 1) * 80,
      firstMediaTimestampMs: 0, lastMediaTimestampMs: (count - 1) * 80,
      coverage: { frames: count, leftHand: count, rightHand: count, pose: count, face: count },
      warnings: [], inferenceMilliseconds: { total: 0, maximum: 0 },
    } as ExtractionResult;
  });
  return { curation: { samples, curationSHA256: {} }, sourceArtifactSHA256: { 'manifest.json': 'c'.repeat(64) },
    extraction: { extractionDatasetId: 'mosl-smoke5-landmarks-v1', extractionSchemaVersion: 1, sourceCurationId: 'mosl-smoke5-v1', sourceVocabularyId: 'mosl-smoke5-v1',
      landmarkFrame: { schemaVersion: 1, topology: 'human-553-v1', anatomicalHands: true, mirrored: false }, status: 'COMPLETE',
      sourceSampleCount: 21, classCount: 5, successfulExtractions: 21, failedExtractions: 0, pendingExtractions: 0,
      totalSelectedSourceVideos: 21, totalLandmarkFrameCount: 932, delegate: 'GPU', curationSHA256: {}, samples: results,
    } } as FeatureInputs;
}
test('raw little-endian serialization is 43,520 bytes and round-trips independently of host byte order', () => {
  const tensor = new Float32Array(10880); tensor[0] = 1; tensor[1] = -2.5; tensor[10879] = Math.fround(1 / 3);
  const bytes = serializeTensor(tensor);
  assert.equal(TENSOR_BYTES, 43520); assert.equal(bytes.length, 43520);
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 0, 128, 63, 0, 0, 32, 192]);
  assert.deepEqual(deserializeTensor(bytes), tensor);
  assert.equal(sha256(serializeTensor(deserializeTensor(bytes))), sha256(bytes));
});
test('serialization rejects wrong shapes/lengths and nonfinite stored values', () => {
  assert.throws(() => serializeTensor(new Float32Array(170)), /64,170/);
  assert.throws(() => deserializeTensor(Buffer.alloc(43521)), /byte count/);
  const tensor = new Float32Array(10880); tensor[3] = Infinity;
  assert.throws(() => serializeTensor(tensor), /Nonfinite/);
  const bytes = Buffer.alloc(43520); bytes.writeFloatLE(NaN, 4);
  assert.throws(() => deserializeTensor(bytes), /Nonfinite/);
});
test('sample IDs are preserved in metadata but file names are safely encoded', () => {
  const id = `mosl-smoke5-v1:${'1'.repeat(64)}`;
  assert.equal(tensorOutputPath(id), `samples/mosl-smoke5-v1%3A${'1'.repeat(64)}.f32`);
  for (const bad of ['../raw.mp4', 'C:\\private\\video.mp4', 'mosl-smoke5-v1:../x', 'mosl-smoke5-v1:con']) assert.throws(() => tensorOutputPath(bad));
  for (const bad of ['../landmarks-v1/manifest.json', 'samples/x.f32', 'samples/../../source/a.mp4', 'manifest.json.pending', 'README.md:alternate']) assert.throws(() => validateFeatureOutputName(bad));
  validateFeatureOutputName(tensorOutputPath(id)); validateFeatureOutputName('manifest.json');
});
test('frozen input compatibility validates sample/class order, identity, version and aggregate frame count', () => {
  const data = fixture(); validateExtractionCompatibility(data.extraction, data.curation);
  const variants = [
    (d: FeatureInputs) => { d.extraction.extractionSchemaVersion = 2; },
    (d: FeatureInputs) => { d.extraction.samples.reverse(); },
    (d: FeatureInputs) => { d.extraction.samples[0].classId = 'another'; },
    (d: FeatureInputs) => { d.extraction.samples[0].sourceVideoSHA256 = 'd'.repeat(64); },
    (d: FeatureInputs) => { d.extraction.samples[0].outputRelativePath = '../raw.mp4'; },
    (d: FeatureInputs) => { d.extraction.samples[0].delegate = 'CPU'; },
    (d: FeatureInputs) => { d.extraction.samples[0].extractedLandmarkFrameCount--; },
    (d: FeatureInputs) => { d.extraction.curationSHA256['samples.jsonl'] = 'changed'; },
    (d: FeatureInputs) => { d.extraction.samples[1] = d.extraction.samples[0]; },
  ];
  for (const mutate of variants) { const data = fixture(); mutate(data); assert.throws(() => validateExtractionCompatibility(data.extraction, data.curation)); }
});
test('index records carry source hashes and FAIL samples cannot claim tensors', () => {
  const inputs = fixture(); const sample = inputs.curation.samples[0], source = inputs.extraction.samples[0];
  const failed = preprocessSequence(goldenSequence().map(frame => ({ ...frame, leftHand: null, rightHand: null })));
  const index = createIndexRecord(sample, source, failed, null);
  assert.equal(index.sampleId, sample.sampleId); assert.equal(index.sourceLandmarkSha256, source.outputSHA256);
  assert.equal(index.tensorRelativePath, null); assert.equal(index.tensorSha256, null);
  assert.throws(() => createIndexRecord(sample, source, failed, Buffer.alloc(43520)));
});
test('manifest construction includes all 21 attempts, deterministic outputs and only PASS binary artifacts', () => {
  const inputs = fixture();
  const attempts: FeatureAttempt[] = inputs.curation.samples.map((sample, i) => processVerifiedSequence(sample, inputs.extraction.samples[i],
    i === 0 ? goldenSequence().map(frame => ({ ...frame, leftHand: null, rightHand: null })) : goldenSequence()));
  const timestamp = '2026-01-01T00:00:00.000Z';
  const first = createFeatureArtifacts(inputs, attempts, timestamp, {}), second = createFeatureArtifacts(inputs, attempts, timestamp, {});
  assert.deepEqual(first, second); assert.equal(first.manifest.passCount, 20); assert.equal(first.manifest.failCount, 1);
  assert.equal(Object.keys(first.files).filter(name => name.endsWith('.f32')).length, 20);
  assert(!Object.hasOwn(first.files, tensorOutputPath(inputs.curation.samples[0].sampleId)));
  const records = first.files['dataset-index.jsonl'].toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line) as { sampleId: string });
  assert.equal(records.length, 21); assert.equal(new Set(records.map(row => row.sampleId)).size, 21);
  for (const [name, hash] of Object.entries(first.manifest.outputSHA256)) assert.equal(sha256(first.files[name]), hash);
  assert.equal(first.manifest.perClass[0].pass, 3);
  assert.throws(() => createFeatureArtifacts(inputs, attempts.slice(1), timestamp, {}));
});

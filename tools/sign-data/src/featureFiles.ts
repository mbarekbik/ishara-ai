import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, link, unlink, readdir, stat } from 'node:fs/promises';
import { CONTRACT, FEATURE_WIDTH, SEQUENCE_LENGTH } from '../../../shared/sign-preprocessing/schema.ts';
import { preprocessSequence } from '../../../shared/sign-preprocessing/preprocess.ts';
import type { PreprocessingResult } from '../../../shared/sign-preprocessing/preprocess.ts';
import { SMOKE_CLASSES, VOCABULARY_ID } from './curation.ts';
import { DERIVED_ROOT, EXTRACTION_ID, countCoverage, emptyCoverage, loadExtractionInputs, readSafe, verifyExtractionSources } from './extractionFiles.ts';
import type { ExtractionInputs, ExtractionResult, buildExtractionManifest } from './extractionFiles.ts';
import { sampleOutputPath, serializeLandmarkFrame, validateLandmarkFrame } from './extractionModel.ts';
import type { ExtractionSample, LandmarkFrame } from './extractionModel.ts';
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT, sha256 } from './sourceFiles.ts';

export const FEATURES_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/derived/mosl-v1/smoke5-v1/features-v1');
export const TENSOR_DATASET_ID = 'mosl-smoke5-features-v1';
export const TENSOR_BYTES = SEQUENCE_LENGTH * FEATURE_WIDTH * 4;
type LandmarkManifest = Pick<ReturnType<typeof buildExtractionManifest>,
  'extractionDatasetId' | 'extractionSchemaVersion' | 'sourceCurationId' | 'sourceVocabularyId' |
  'landmarkFrame' | 'status' | 'sourceSampleCount' | 'classCount' | 'successfulExtractions' |
  'failedExtractions' | 'pendingExtractions' | 'totalSelectedSourceVideos' | 'totalLandmarkFrameCount' |
  'delegate' | 'curationSHA256' | 'samples'>;
const encodeJson = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export function tensorOutputPath(sampleId: string): string {
  return sampleOutputPath(sampleId).replace(/\.jsonl$/u, '.f32');
}
export function serializeTensor(tensor: Float32Array): Buffer {
  assert(tensor instanceof Float32Array && tensor.length === SEQUENCE_LENGTH * FEATURE_WIDTH, 'Expected Float32 [64,170]');
  const buffer = Buffer.alloc(TENSOR_BYTES);
  tensor.forEach((value, i) => { assert(Number.isFinite(value), 'Nonfinite tensor'); buffer.writeFloatLE(value, i * 4); });
  return buffer;
}
export function deserializeTensor(buffer: Uint8Array): Float32Array {
  assert.equal(buffer.byteLength, TENSOR_BYTES, 'Incorrect tensor byte count');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const result = new Float32Array(SEQUENCE_LENGTH * FEATURE_WIDTH);
  for (let i = 0; i < result.length; i++) {
    const value = view.getFloat32(i * 4, true);
    assert(Number.isFinite(value), 'Nonfinite stored Float32'); result[i] = value;
  }
  return result;
}

export function validateExtractionCompatibility(manifest: LandmarkManifest, inputs: ExtractionInputs): void {
  assert.equal(manifest.extractionDatasetId, EXTRACTION_ID);
  assert.equal(manifest.extractionSchemaVersion, 1, 'Unsupported extraction version');
  assert.equal(manifest.sourceCurationId, VOCABULARY_ID);
  assert.equal(manifest.sourceVocabularyId, VOCABULARY_ID);
  assert.deepEqual(manifest.landmarkFrame, { schemaVersion: 1, topology: 'human-553-v1', anatomicalHands: true, mirrored: false });
  assert.equal(manifest.status, 'COMPLETE');
  assert.equal(manifest.sourceSampleCount, 21); assert.equal(inputs.samples.length, 21);
  assert.equal(manifest.classCount, 5); assert.equal(manifest.successfulExtractions, 21);
  assert.equal(manifest.failedExtractions, 0); assert.equal(manifest.pendingExtractions, 0);
  assert.equal(manifest.totalSelectedSourceVideos, 21);
  assert.equal(manifest.totalLandmarkFrameCount, 932);
  assert.equal(manifest.delegate, 'GPU', 'Frozen extraction delegate differs');
  assert.deepEqual(manifest.curationSHA256, inputs.curationSHA256, 'Curation differs from extraction provenance');
  assert(Array.isArray(manifest.samples) && manifest.samples.length === 21);
  assert.equal(new Set(manifest.samples.map(sample => sample.sampleId)).size, 21, 'Repeated extraction sample');
  assert.equal(manifest.samples.reduce((sum, sample) => sum + sample.extractedLandmarkFrameCount, 0), manifest.totalLandmarkFrameCount);
  for (const [index, sample] of inputs.samples.entries()) {
    const result = manifest.samples[index];
    for (const key of ['sampleId', 'classId', 'classIndex', 'rawSourceLabel', 'sourceCsv', 'sourceRow', 'declaredSignerId'] as const) assert.equal(result[key], sample[key], `Extraction/curation mismatch: ${key}`);
    assert.equal(result.sourceVideoRelativePath, sample.localVideoRelativePath);
    assert.equal(result.sourceVideoSHA256, sample.sha256);
    assert.equal(result.sourceDurationSeconds, sample.duration);
    assert.deepEqual(result.sourceDimensions, sample.resolution);
    assert.equal(result.status, 'success'); assert.equal(result.delegate, manifest.delegate); assert.equal(result.error, null);
    assert.equal(result.outputRelativePath, sampleOutputPath(sample.sampleId));
    assert(typeof result.outputSHA256 === 'string' && /^[0-9a-f]{64}$/u.test(result.outputSHA256));
    assert(Number.isSafeInteger(result.extractedLandmarkFrameCount) && result.extractedLandmarkFrameCount > 0);
    assert.equal(result.selectedSourceFrames.length, result.extractedLandmarkFrameCount);
  }
}

export interface FeatureInputs {
  curation: ExtractionInputs; extraction: LandmarkManifest;
  sourceArtifactSHA256: Record<string, string>;
}
export async function loadFeatureInputs(): Promise<FeatureInputs> {
  const curation = await loadExtractionInputs();
  const text = await readSafe(DERIVED_ROOT, 'manifest.json');
  const extraction = JSON.parse(text) as LandmarkManifest;
  validateExtractionCompatibility(extraction, curation);
  const sourceArtifactSHA256: Record<string, string> = { 'manifest.json': sha256(text) };
  for (const name of ['extraction-report.json', 'README.md']) sourceArtifactSHA256[name] = sha256(await readSafe(DERIVED_ROOT, name));
  for (const result of extraction.samples) sourceArtifactSHA256[result.outputRelativePath!] = result.outputSHA256!;
  await verifyExtractionSources(curation);
  return { curation, extraction, sourceArtifactSHA256 };
}

/** Only manifest-named files are read; no dataset discovery or media processing occurs here. */
export async function readLandmarkSequence(result: ExtractionResult): Promise<LandmarkFrame[]> {
  assert.equal(result.outputRelativePath, sampleOutputPath(result.sampleId));
  const path = boundedPath(DERIVED_ROOT, result.outputRelativePath!);
  await assertNoLinks(REPOSITORY_ROOT, path);
  assert((await stat(path)).size <= 64 * 1024 * 1024, 'Source sequence exceeds bounded 64 MiB reader');
  const text = await readSafe(DERIVED_ROOT, result.outputRelativePath!);
  assert.equal(sha256(text), result.outputSHA256, `Landmark hash mismatch: ${result.sampleId}`);
  assert(text.endsWith('\n') && !text.startsWith('\uFEFF'), 'Expected canonical UTF-8 JSONL');
  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines.length, result.extractedLandmarkFrameCount);
  const coverage = emptyCoverage();
  const frames = lines.map((line, index) => {
    const selected = result.selectedSourceFrames[index];
    assert(selected, 'Extra source observation');
    const frame = validateLandmarkFrame(JSON.parse(line), {
      trackingRunId: `${EXTRACTION_ID}:${result.sampleId}`, sequence: index + 1,
      timestampMs: selected.timestampMs, ...result.sourceDimensions,
    });
    assert.equal(serializeLandmarkFrame(frame), line + '\n');
    assert(frame.timestampMs >= result.mediaStartMs && frame.timestampMs <= result.mediaEndMs, 'Timestamp outside media bounds');
    countCoverage(coverage, frame); return frame;
  });
  assert.deepEqual(coverage, result.coverage);
  assert.equal(frames[0].timestampMs, result.firstMediaTimestampMs);
  assert.equal(frames.at(-1)!.timestampMs, result.lastMediaTimestampMs);
  return frames;
}

export async function verifyFeatureSources(inputs: FeatureInputs): Promise<void> {
  await verifyExtractionSources(inputs.curation);
  for (const [name, digest] of Object.entries(inputs.sourceArtifactSHA256)) {
    const path = boundedPath(DERIVED_ROOT, name);
    await assertNoLinks(REPOSITORY_ROOT, path);
    assert.equal((await hashFile(path)).sha256, digest, `Frozen landmark artifact changed: ${name}`);
  }
}

export function createIndexRecord(sample: ExtractionSample, source: ExtractionResult, result: PreprocessingResult, bytes: Buffer | null) {
  assert.equal(sample.sampleId, source.sampleId);
  assert.equal(result.qualityStatus === 'PASS', bytes !== null);
  if (bytes) deserializeTensor(bytes);
  const { bodyAnchorCoverage, anyHandCoverage, leftHandCoverage, rightHandCoverage, poseCoverage, faceCoverage } = result.metrics;
  return {
    sampleId: sample.sampleId, classId: sample.classId, classIndex: sample.classIndex,
    sourceCsv: sample.sourceCsv, sourceRow: sample.sourceRow, declaredSignerId: sample.declaredSignerId,
    sourceLandmarkRelativePath: `../landmarks-v1/${source.outputRelativePath}`,
    sourceLandmarkSha256: source.outputSHA256,
    preprocessingVersion: CONTRACT.preprocessingVersion, featureSchemaVersion: CONTRACT.featureSchemaVersion,
    sequenceLength: SEQUENCE_LENGTH, featureWidth: FEATURE_WIDTH,
    tensorRelativePath: bytes ? tensorOutputPath(sample.sampleId) : null,
    tensorSha256: bytes ? sha256(bytes) : null,
    qualityStatus: result.qualityStatus, bodyAnchorCoverage, anyHandCoverage, leftHandCoverage, rightHandCoverage,
    poseCoverage, faceCoverage, sourceDurationSeconds: result.sourceDurationSeconds,
    preprocessingWarnings: result.warnings, failureReasons: result.failureReasons,
  };
}
type IndexRecord = ReturnType<typeof createIndexRecord>;
export interface FeatureAttempt { index: IndexRecord; result: PreprocessingResult; bytes: Buffer | null }
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1)! };
};

export function createFeatureArtifacts(inputs: FeatureInputs, attempts: FeatureAttempt[], generationTimestamp: string, implementationSHA256: Record<string, string>) {
  assert.equal(attempts.length, 21); assert.equal(new Set(attempts.map(attempt => attempt.index.sampleId)).size, 21);
  assert(Number.isFinite(Date.parse(generationTimestamp)), 'Invalid generation timestamp');
  attempts.forEach((attempt, i) => assert.equal(attempt.index.sampleId, inputs.curation.samples[i].sampleId));
  const pass = attempts.filter(attempt => attempt.index.qualityStatus === 'PASS').length;
  const perClass = SMOKE_CLASSES.map(definition => {
    const members = attempts.filter(attempt => attempt.index.classId === definition.classId);
    const passed = members.filter(attempt => attempt.index.qualityStatus === 'PASS').length;
    return { classId: definition.classId, classIndex: definition.classIndex, attempted: members.length, pass: passed, fail: members.length - passed };
  });
  const coverageSummary = Object.fromEntries((['bodyAnchorCoverage', 'anyHandCoverage', 'leftHandCoverage', 'rightHandCoverage', 'poseCoverage', 'faceCoverage'] as const).map(key => [key, summary(attempts.map(attempt => attempt.index[key]))]));
  const quality = {
    tensorDatasetId: TENSOR_DATASET_ID, preprocessingVersion: CONTRACT.preprocessingVersion,
    qualityPolicyVersion: CONTRACT.qualityPolicyVersion, coverageSemantics: CONTRACT.coverage,
    attempted: 21, pass, fail: 21 - pass, perClass, coverageSummary,
    finiteValueValidation: { tensors: pass, valuesPerTensor: SEQUENCE_LENGTH * FEATURE_WIDTH, allFinite: true },
    samples: attempts.map(attempt => ({ ...attempt.index, metrics: attempt.result.metrics })),
  };
  const files: Record<string, Buffer> = {};
  for (const attempt of attempts) {
    assert.equal(attempt.index.qualityStatus === 'PASS', attempt.bytes !== null);
    if (attempt.bytes) {
      assert.equal(sha256(attempt.bytes), attempt.index.tensorSha256); deserializeTensor(attempt.bytes);
      files[attempt.index.tensorRelativePath!] = attempt.bytes;
    }
  }
  files['dataset-index.jsonl'] = Buffer.from(attempts.map(attempt => JSON.stringify(attempt.index)).join('\n') + '\n', 'utf8');
  files['quality-report.json'] = Buffer.from(encodeJson(quality), 'utf8');
  files['README.md'] = Buffer.from([
    '# smoke5-v1 fixed feature dataset', '',
    'Input: the frozen, versioned landmarks-v1 LandmarkFrame sequences (21 source recordings).',
    'Process: validation → pixel geometry normalization → 64 media-time positions → 170 features, masks and post-resampling velocities → duration and supported-time quality gates.',
    `Output: ${pass} PASS tensors; ${21 - pass} FAIL samples remain in the index/report and have no tensor. No samples were replaced.`, '',
    'Each samples/*.f32 file is raw, headerless little-endian Float32, row-major [64,170], 10,880 values / 43,520 bytes. No batch dimension.',
    "A later Python consumer can load bytes using numpy.fromfile(path, dtype='<f4').reshape(64,170); it must not reimplement preprocessing.", '',
    `Authoritative pure TypeScript: shared/sign-preprocessing/preprocess.ts; contract ${CONTRACT.preprocessingVersion}. Full equations, feature offsets, masks and versioned policies are in manifest.json and shared/sign-preprocessing/README.md.`,
    'Quality coverage uses supported adjacent media-time intervals, not observation counts. Missing observations and gaps over 250 ms reduce coverage. Body >=85%; any hand >=70%; duration 0.75..10 s. Hand coverage does not require two hands or face visibility.',
    'Missing local-hand geometry is zero with its hand mask zero. Body-relative wrist coordinates additionally require both shoulder masks. Velocities also require continuous supported source intervals. The first velocity timestep is zero/mask0.', '',
    'This is an engineering smoke subset only. Each class has one declared signer; it cannot support signer-independent performance claims. Linguistic review remains unverified.',
    'No model has been trained. No ONNX artifact or Sign → Text recognition was created. No split, augmentation, or learned scaler was fitted. Failed samples were not substituted or made training-eligible.', '',
    'All private artifacts stay under Git-ignored data/scope5. Raw videos, curation, and landmarks remain untouched. manifest.json records source and output SHA-256 hashes.',
    'Generate: npm --prefix tools/sign-data run preprocess:smoke5',
    'Read-only integrity and equivalent deterministic regeneration: npm --prefix tools/sign-data run verify:features', '',
  ].join('\n'), 'utf8');
  const manifest = {
    tensorDatasetId: TENSOR_DATASET_ID, tensorDatasetSchemaVersion: 1,
    sourceExtractionDatasetId: inputs.extraction.extractionDatasetId, sourceCurationId: VOCABULARY_ID, vocabularyId: VOCABULARY_ID,
    classOrdering: SMOKE_CLASSES.map(({ classId, classIndex }) => ({ classId, classIndex })),
    sourceSampleCount: 21, sourceLandmarkFrameCount: 932, preprocessingAttemptCount: 21, passCount: pass, failCount: 21 - pass,
    tensor: { shape: [SEQUENCE_LENGTH, FEATURE_WIDTH], dtype: 'float32', byteOrder: 'little-endian', serialization: 'raw-headerless-row-major-f32', values: SEQUENCE_LENGTH * FEATURE_WIDTH, bytes: TENSOR_BYTES },
    contract: CONTRACT, implementationToolVersion: '1', implementationSHA256, generationTimestamp,
    sourceManifestHashes: { curation: inputs.curation.curationSHA256, landmarks: inputs.sourceArtifactSHA256 },
    outputSHA256: Object.fromEntries(Object.entries(files).map(([name, buffer]) => [name, sha256(buffer)])),
    perClass, coverageSummary, status: 'COMPLETE', purpose: 'ENGINEERING_SMOKE_TEST_ONLY', linguisticReviewStatus: 'unverified',
    validation: { allInputsAttempted: true, sourceIntegrity: 'verified-before-publication-and-after', deterministicTensorRegeneration: true, finiteTensors: true },
  };
  files['manifest.json'] = Buffer.from(encodeJson(manifest), 'utf8');
  return { files, manifest, quality };
}

export function validateFeatureOutputName(name: string): void {
  assert(['manifest.json', 'dataset-index.jsonl', 'quality-report.json', 'README.md'].includes(name) || /^samples\/mosl-smoke5-v1%3A[0-9a-f]{64}\.f32$/u.test(name), 'Unexpected tensor output path');
}
export async function writeFeatureFile(name: string, bytes: Buffer): Promise<void> {
  validateFeatureOutputName(name);
  const target = boundedPath(FEATURES_ROOT, name);
  const pending = boundedPath(FEATURES_ROOT, name + '.pending');
  await assertNoLinks(REPOSITORY_ROOT, target); await assertNoLinks(REPOSITORY_ROOT, pending);
  try {
    const existing = await readFile(target);
    assert(existing.equals(bytes), `Existing output differs; refusing overwrite: ${name}`); return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let owned = false;
  try {
    await writeFile(pending, bytes, { flag: 'wx' }); owned = true;
    await link(pending, target);
  } finally { if (owned) await unlink(pending); }
}
export async function initializeFeatures(): Promise<void> {
  const samples = boundedPath(FEATURES_ROOT, 'samples');
  await assertNoLinks(REPOSITORY_ROOT, samples); await mkdir(samples, { recursive: true });
}
export async function verifyFeatureOutputs(files: Record<string, Buffer>): Promise<void> {
  const found: string[] = [];
  await assertNoLinks(REPOSITORY_ROOT, FEATURES_ROOT);
  for (const entry of await readdir(FEATURES_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'samples') {
      const directory = boundedPath(FEATURES_ROOT, 'samples'); await assertNoLinks(REPOSITORY_ROOT, directory);
      for (const child of await readdir(directory, { withFileTypes: true })) { assert(child.isFile(), 'Unexpected tensor directory entry'); found.push(`samples/${child.name}`); }
    } else { assert(entry.isFile(), 'Unexpected feature output entry'); found.push(entry.name); }
  }
  assert.deepEqual(found.sort(), Object.keys(files).sort(), 'Physical tensor artifacts do not match manifest generation');
  for (const [name, expected] of Object.entries(files)) {
    validateFeatureOutputName(name);
    const path = boundedPath(FEATURES_ROOT, name); await assertNoLinks(REPOSITORY_ROOT, path);
    const actual = await readFile(path); assert(actual.equals(expected), `Output or deterministic regeneration mismatch: ${name}`);
    assert.equal(sha256(actual), sha256(expected));
    if (name.endsWith('.f32')) deserializeTensor(actual);
    if (name.endsWith('.json')) JSON.parse(actual.toString('utf8'));
    if (name.endsWith('.jsonl')) actual.toString('utf8').trimEnd().split('\n').forEach(line => JSON.parse(line));
  }
}

export async function implementationHashes(): Promise<Record<string, string>> {
  const names = ['schema', 'validation', 'spatial', 'temporal', 'preprocess'].map(name => `shared/sign-preprocessing/${name}.ts`);
  names.push('tools/sign-data/src/featureFiles.ts', 'tools/sign-data/src/preprocess-smoke5.ts');
  const hashes: Record<string, string> = {};
  for (const name of names) hashes[name] = sha256(await readSafe(REPOSITORY_ROOT, name));
  return hashes;
}

export function processVerifiedSequence(sample: ExtractionSample, source: ExtractionResult, frames: LandmarkFrame[]): FeatureAttempt {
  const result = preprocessSequence(frames);
  const regenerated = preprocessSequence(frames);
  assert.deepEqual(regenerated, result, 'Pure preprocessing is not deterministic');
  const bytes = result.tensor ? serializeTensor(result.tensor) : null;
  if (bytes) assert(bytes.equals(serializeTensor(regenerated.tensor!)), 'Tensor regeneration bytes differ');
  // Avoid retaining both numerical tensors and their encoded copies across source recordings.
  const diagnostics = { ...result, tensor: null };
  return { index: createIndexRecord(sample, source, result, bytes), result: diagnostics, bytes };
}

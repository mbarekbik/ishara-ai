import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTRACT } from '../../../shared/sign-preprocessing/schema.ts';
import { CURATION_OUTPUT_NAMES, validateSourceReference } from './curation.ts';
import { readSafe } from './extractionFiles.ts';
import { deserializeTensor } from './featureFiles.ts';
import { assertNoLinks, boundedPath, hashFile, ordinal, REPOSITORY_ROOT, SOURCE_ROOT, sha256 } from './sourceFiles.ts';
import { filesUnder, V2_CURATION_ROOT, V2_FEATURE_ROOT, V2_LANDMARK_ROOT, V2_ROOT } from './smokeV2Files.ts';
import { v2SamplePath, type V2FeatureRecord, type V2Sample } from './smokeV2.ts';
import { assertSHA256, buildProtocolArtifacts, CLASS_ORDER, DATASET_ID, FEATURE_DATASET_ID, PROTOCOL_OUTPUTS, selectEligible, validateProtocolOutputName, verifyFrozenProtocol, type ProtocolOutputName } from './trainingProtocol.ts';

export const PROTOCOL_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/training/mosl-v1/smoke5-v2/protocol-v1');
// Pins the already accepted dataset, before this protocol was designed or any model was fitted.
export const ACCEPTED_FEATURE_MANIFEST_SHA256 = '87f9686b3b3010bb07048e93f02d20eb68cd23780c514f1e25fc8a96d9fbf6cb';
const TOOL_FILES = ['trainingProtocol.ts', 'trainingProtocolPolicy.ts', 'trainingProtocolFiles.ts', 'freeze-training-protocol.ts'];
interface FeatureManifest {
  tensorDatasetId: string; datasetId: string; vocabularyId: string; status: string; trainingReady: boolean;
  sourceSampleCount: number; passCount: number; failCount: number; contract: typeof CONTRACT;
  tensor: { shape: number[]; dtype: string; byteOrder: string; serialization: string; values: number; bytes: number };
  classOrdering: { classId: string; classIndex: number }[];
  sourceManifestHashes: { curation: Record<string, string>; landmarks: Record<string, string> };
  implementationSHA256: Record<string, string>; outputSHA256: Record<string, string>;
}

function safeReference(name: string): void {
  assert(!/[\\:\p{Cc}]/u.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe source reference');
}
function repositoryReference(root: string, name: string): string {
  safeReference(name);
  return relative(REPOSITORY_ROOT, boundedPath(root, name)).replaceAll('\\', '/');
}
export function protocolOutputPath(name: string): string {
  validateProtocolOutputName(name);
  return boundedPath(PROTOCOL_ROOT, name);
}

/** Read-only metadata/hash checks. No decoder, landmark processing or training loader is invoked. */
export async function loadProtocolInputs() {
  const protectedSHA256: Record<string, string> = {};
  const protect = async (root: string, name: string, expected?: string): Promise<string> => {
    const reference = repositoryReference(root, name), path = boundedPath(REPOSITORY_ROOT, reference);
    await assertNoLinks(REPOSITORY_ROOT, path);
    const actual = (await hashFile(path)).sha256;
    if (expected !== undefined) {
      assert.match(expected, /^[0-9a-f]{64}$/u);
      assert.equal(actual, expected, `Source hash differs: ${reference}`);
    }
    if (protectedSHA256[reference]) assert.equal(actual, protectedSHA256[reference], `Input changed while loading: ${reference}`);
    protectedSHA256[reference] = actual;
    return actual;
  };
  await protect(V2_FEATURE_ROOT, 'manifest.json', ACCEPTED_FEATURE_MANIFEST_SHA256);
  const featureText = await readSafe(V2_FEATURE_ROOT, 'manifest.json');
  assertSHA256(featureText, ACCEPTED_FEATURE_MANIFEST_SHA256, 'accepted feature manifest');
  const manifest = JSON.parse(featureText) as FeatureManifest;
  assert.equal(manifest.tensorDatasetId, FEATURE_DATASET_ID);
  assert.equal(manifest.datasetId, DATASET_ID); assert.equal(manifest.vocabularyId, DATASET_ID);
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.trainingReady, true);
  assert.equal(manifest.sourceSampleCount, 22); assert.equal(manifest.passCount, 14); assert.equal(manifest.failCount, 8);
  assert.deepEqual(manifest.contract, CONTRACT);
  assert.deepEqual(manifest.tensor, { shape: [64, 170], dtype: 'float32', byteOrder: 'little-endian', serialization: 'raw-headerless-row-major-f32', values: 10880, bytes: 43520 });
  assert.deepEqual(manifest.classOrdering, CLASS_ORDER.map((classId, classIndex) => ({ classId, classIndex })));

  assert.deepEqual(Object.keys(manifest.sourceManifestHashes.curation).sort(ordinal), [...CURATION_OUTPUT_NAMES].sort(ordinal));
  for (const [root, hashes] of [[V2_CURATION_ROOT, manifest.sourceManifestHashes.curation], [V2_LANDMARK_ROOT, manifest.sourceManifestHashes.landmarks], [V2_FEATURE_ROOT, manifest.outputSHA256]] as const) {
    for (const [name, expected] of Object.entries(hashes)) await protect(root, name, expected);
    assert.deepEqual(await filesUnder(root), [...Object.keys(hashes), ...(root === V2_FEATURE_ROOT ? ['manifest.json'] : [])].sort(ordinal), 'Unexpected source artifact file');
  }
  for (const [name, expected] of Object.entries(manifest.implementationSHA256)) await protect(REPOSITORY_ROOT, name, expected);
  const sharedFiles = await filesUnder(boundedPath(REPOSITORY_ROOT, 'shared/sign-preprocessing'));
  for (const name of sharedFiles) {
    const reference = `shared/sign-preprocessing/${name}`;
    if (!manifest.implementationSHA256[reference]) {
      assert(name === 'README.md' || name === 'tsconfig.json', 'Unbound shared preprocessing implementation');
      // The feature manifest binds executable math; also preserve its companion documentation/config.
      await protect(REPOSITORY_ROOT, reference);
    }
  }

  const indexText = await readSafe(V2_FEATURE_ROOT, 'dataset-index.jsonl');
  assertSHA256(indexText, manifest.outputSHA256['dataset-index.jsonl'], 'feature index');
  assert(indexText.endsWith('\n'));
  const records = indexText.trimEnd().split('\n').map(line => JSON.parse(line) as V2FeatureRecord);
  const verifiedTensors: Record<string, string> = {};
  for (const row of records) {
    if (row.qualityStatus === 'FAIL') { assert.equal(row.tensorRelativePath, null); assert.equal(row.tensorSha256, null); continue; }
    assert.equal(row.qualityStatus, 'PASS');
    assert.equal(row.tensorRelativePath, v2SamplePath(row.sampleId, 'f32'));
    assert.equal(row.tensorSha256, manifest.outputSHA256[row.tensorRelativePath!]);
    const bytes = await readFile(boundedPath(V2_FEATURE_ROOT, row.tensorRelativePath!));
    assertSHA256(bytes, row.tensorSha256!, `tensor ${row.sampleId}`);
    // Integrity inspection only: no features are fitted, selected, aggregated or transformed.
    deserializeTensor(bytes);
    verifiedTensors[row.tensorRelativePath!] = row.tensorSha256!;
  }
  assert.deepEqual(Object.keys(manifest.outputSHA256).filter(name => name.endsWith('.f32')).sort(ordinal), Object.keys(verifiedTensors).sort(ordinal), 'Unexpected tensor, including possible FAIL tensor');
  const eligible = selectEligible(records, verifiedTensors);

  const vocabulary = JSON.parse(await readSafe(V2_CURATION_ROOT, 'vocabulary.json')) as {
    vocabularyId: string; classes: { classId: string; classIndex: number }[];
    evidence: { auditChecksumsSHA256: string };
  };
  assert.equal(vocabulary.vocabularyId, DATASET_ID);
  assert.deepEqual(vocabulary.classes.map(({ classId, classIndex }) => ({ classId, classIndex })), manifest.classOrdering);
  const curated = (await readSafe(V2_CURATION_ROOT, 'samples.jsonl')).trimEnd().split('\n').map(line => JSON.parse(line) as V2Sample);
  assert.equal(curated.length, 22); assert.equal(new Set(curated.map(s => s.sampleId)).size, 22);
  assert.deepEqual(curated.map(s => s.sampleId).sort(ordinal), records.map(s => s.sampleId).sort(ordinal));
  for (const sample of curated) {
    const row = records.find(r => r.sampleId === sample.sampleId)!;
    assert.equal(sample.eligibility, 'ELIGIBLE_ENGINEERING_ONLY');
    assert.equal(row.classId, sample.classId); assert.equal(row.classIndex, sample.classIndex);
    assert.equal(row.sourceCsv, sample.sourceCsv); assert.equal(row.sourceRow, sample.sourceRow);
    assert.equal(row.sourceVideoSHA256, sample.sha256); assert.equal(row.artifactOrigin, sample.artifactOrigin);
    validateSourceReference(sample.localVideoRelativePath, 'videos');
    await protect(SOURCE_ROOT, sample.localVideoRelativePath, sample.sha256);
  }
  // The accepted feature manifest binds curation, whose evidence binds the original audit checksums.
  // Do not treat an unanchored generation-state snapshot as a checksum authority.
  await protect(V2_ROOT, 'generation-state.json');
  const checksumRoot = boundedPath(REPOSITORY_ROOT, 'data/scope5/audit/mosl-v1');
  await protect(checksumRoot, 'checksums.sha256', vocabulary.evidence.auditChecksumsSHA256);
  const checksumText = await readSafe(checksumRoot, 'checksums.sha256');
  assertSHA256(checksumText, vocabulary.evidence.auditChecksumsSHA256, 'accepted audit checksum manifest');
  const csvChecks = checksumText.trimEnd().split(/\r?\n/u).filter(line => line.endsWith('.csv'));
  assert.equal(csvChecks.length, 5);
  for (const line of csvChecks) {
    const match = /^([0-9a-f]{64}) {2}(metadata\/.+\.csv)$/u.exec(line); assert(match, 'Invalid CSV checksum entry');
    await protect(SOURCE_ROOT, match[2], match[1]);
  }
  await protect(V2_ROOT, 'validation.json');
  const acceptedValidation = JSON.parse(await readSafe(V2_ROOT, 'validation.json')) as { status: string; trainingReady: boolean };
  assert.equal(acceptedValidation.status, 'VERIFIED'); assert.equal(acceptedValidation.trainingReady, true);
  const sourceManifestHashes = Object.fromEntries([
    repositoryReference(V2_FEATURE_ROOT, 'manifest.json'), repositoryReference(V2_FEATURE_ROOT, 'dataset-index.jsonl'),
    repositoryReference(V2_FEATURE_ROOT, 'quality-report.json'), repositoryReference(V2_LANDMARK_ROOT, 'manifest.json'),
    ...CURATION_OUTPUT_NAMES.map(name => repositoryReference(V2_CURATION_ROOT, name)),
  ].map(name => [name, protectedSHA256[name]]));
  const implementationSHA256: Record<string, string> = {};
  for (const name of TOOL_FILES) implementationSHA256[`tools/sign-data/src/${name}`] = await protect(REPOSITORY_ROOT, `tools/sign-data/src/${name}`);
  return { eligible, records, binding: { sourceManifestHashes, sourceIntegritySHA256: protectedSHA256, implementationSHA256 } };
}

export async function verifyProtocolSources(expected: Record<string, string>): Promise<void> {
  for (const [name, digest] of Object.entries(expected)) {
    safeReference(name);
    const path = boundedPath(REPOSITORY_ROOT, name); await assertNoLinks(REPOSITORY_ROOT, path);
    assert.equal((await hashFile(path)).sha256, digest, `Source changed; protocol publication rejected: ${name}`);
  }
}

export function verifyProtocolGitProtection(): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git('ls-files', '--', 'data/scope5'), '', 'Private data is tracked');
  for (const name of PROTOCOL_OUTPUTS) assert(git('check-ignore', repositoryReference(PROTOCOL_ROOT, name)), 'Protocol output must be Git-ignored');
}

export async function publishProtocol(expected: ReturnType<typeof buildProtocolArtifacts>): Promise<void> {
  await assertNoLinks(REPOSITORY_ROOT, PROTOCOL_ROOT);
  verifyProtocolGitProtection();
  // Check the whole existing set before adding anything; differing v1 content is never overwritten.
  for (const name of PROTOCOL_OUTPUTS) {
    const target = protocolOutputPath(name); await assertNoLinks(REPOSITORY_ROOT, target);
    try { assert.equal(await readFile(target, 'utf8'), expected.files[name], `Existing frozen protocol differs: ${name}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await verifyProtocolSources(expected.protocol.sourceIntegritySHA256);
  await mkdir(PROTOCOL_ROOT, { recursive: true });
  for (const name of PROTOCOL_OUTPUTS) {
    const target = protocolOutputPath(name), pending = boundedPath(PROTOCOL_ROOT, `${name}.pending`);
    await assertNoLinks(REPOSITORY_ROOT, pending);
    let owned = false;
    try {
      await writeFile(pending, expected.files[name], { encoding: 'utf8', flag: 'wx' }); owned = true;
      try { await copyFile(pending, target, constants.COPYFILE_EXCL); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      assertSHA256(await readFile(target), sha256(expected.files[name]), name);
    } finally { if (owned) await unlink(pending); }
  }
}

export async function verifyPublishedProtocol(expected: ReturnType<typeof buildProtocolArtifacts>): Promise<void> {
  const actual = {} as Record<ProtocolOutputName, string>;
  assert.deepEqual(await filesUnder(PROTOCOL_ROOT), [...PROTOCOL_OUTPUTS].sort(ordinal), 'Unexpected protocol artifacts');
  for (const name of PROTOCOL_OUTPUTS) actual[name] = await readSafe(PROTOCOL_ROOT, name);
  verifyFrozenProtocol(actual, expected);
  await verifyProtocolSources(expected.protocol.sourceIntegritySHA256);
  verifyProtocolGitProtection();
}

import assert from 'node:assert/strict';
import { readSafe } from './extractionFiles.ts';
import {
  FEATURES_ROOT, createFeatureArtifacts, implementationHashes, initializeFeatures, loadFeatureInputs,
  processVerifiedSequence, readLandmarkSequence, verifyFeatureOutputs, verifyFeatureSources, writeFeatureFile,
} from './featureFiles.ts';
import type { FeatureAttempt } from './featureFiles.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--verify'), 'Only --verify is supported');
  const verifyOnly = args[0] === '--verify';
  const inputs = await loadFeatureInputs();
  let generationTimestamp = new Date().toISOString();
  try {
    const previous = JSON.parse(await readSafe(FEATURES_ROOT, 'manifest.json')) as { generationTimestamp: string };
    generationTimestamp = previous.generationTimestamp;
  } catch (error) { if (verifyOnly || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const attempts: FeatureAttempt[] = [];
  for (const [index, sample] of inputs.curation.samples.entries()) {
    const source = inputs.extraction.samples[index];
    const frames = await readLandmarkSequence(source);
    const attempt = processVerifiedSequence(sample, source, frames);
    attempts.push(attempt);
    console.log(`${index + 1}/21 ${sample.classId} source row ${sample.sourceRow}: ${attempt.index.qualityStatus}`);
  }
  await verifyFeatureSources(inputs);
  const artifacts = createFeatureArtifacts(inputs, attempts, generationTimestamp, await implementationHashes());
  if (!verifyOnly) {
    await initializeFeatures();
    // The manifest is written last and serves as the completion marker.
    for (const [name, bytes] of Object.entries(artifacts.files)) await writeFeatureFile(name, bytes);
  }
  await verifyFeatureOutputs(artifacts.files);
  await verifyFeatureSources(inputs);
  console.log(JSON.stringify({ status: 'COMPLETE', attempted: 21, pass: artifacts.manifest.passCount, fail: artifacts.manifest.failCount, perClass: artifacts.manifest.perClass, deterministicRegeneration: true, sourceIntegrity: true, verifyOnly }, null, 2));
}
main().catch(error => {
  // Never dump assertion payloads (which can contain private landmark arrays).
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Preprocessing invariant failed');
  process.exitCode = 1;
});

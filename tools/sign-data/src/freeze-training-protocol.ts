import assert from 'node:assert/strict';
import { buildProtocolArtifacts, json } from './trainingProtocol.ts';
import { loadProtocolInputs, publishProtocol, verifyPublishedProtocol } from './trainingProtocolFiles.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--verify'), 'Only --verify is accepted; protocol paths and version are fixed');
  const inputs = await loadProtocolInputs();
  const outputs = buildProtocolArtifacts(inputs.eligible, inputs.binding);
  assert.deepEqual(buildProtocolArtifacts(inputs.eligible, inputs.binding).files, outputs.files, 'Protocol generation is nondeterministic');
  if (args[0] !== '--verify') await publishProtocol(outputs);
  await verifyPublishedProtocol(outputs);
  console.log(json({
    status: 'VERIFIED', protocolId: outputs.protocol.protocolId,
    eligible: outputs.eligible.length, excluded: outputs.validation.excludedQualityFailCount,
    folds: outputs.folds.length, classCounts: outputs.validation.classCounts,
    protocolSHA256: outputs.validation.artifactSHA256['protocol.json'],
    protectedFileCount: outputs.validation.protectedFileCount,
    readyForImplementation: true, modelsFitted: 0, predictionsCreated: 0,
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Protocol freeze failed');
  process.exitCode = 1;
});

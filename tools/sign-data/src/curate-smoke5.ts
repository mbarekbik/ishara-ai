import { collectSourceFiles, verifyBaseline } from "./sourceFiles.ts";
import { CURATION_ROOT, prepareSmokeCuration, publishSmokeCuration, verifySmokeCuration } from "./curationFiles.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify")) throw new Error("Only --verify is accepted; source, vocabulary and output paths are fixed");
  const outputs = await prepareSmokeCuration();
  if (args[0] !== "--verify") await publishSmokeCuration(outputs);
  await verifySmokeCuration(outputs);
  // No repeated decode/probe: final checksums establish source immutability after publication.
  verifyBaseline(await collectSourceFiles());
  const coverage = JSON.parse(outputs["coverage.json"]) as Record<string, unknown>;
  console.log(JSON.stringify({ result: "PASS", outputDirectory: CURATION_ROOT, classes: coverage.classes, totalUsableUniqueSamples: coverage.totalUsableUniqueSamples, exclusions: coverage.totalExcludedCandidates, sourceIntegrity: "BOTH_KNOWN_DIGESTS_MATCH_BEFORE_AND_AFTER", status: coverage.status }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Curation failed");
  process.exitCode = 1;
});

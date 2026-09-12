import { readFile } from "node:fs/promises";
import { OUTPUT_NAMES } from "./auditPackage.ts";
import type { AuditOutputs } from "./auditPackage.ts";
import { assertNoLinks, boundedPath, collectSourceFiles, OUTPUT_ROOT, REPOSITORY_ROOT, verifyBaseline } from "./sourceFiles.ts";
import { validateAuditPackage } from "./validation.ts";

async function main(): Promise<void> {
  const outputs = {} as AuditOutputs;
  for (const name of OUTPUT_NAMES) {
    const path = boundedPath(OUTPUT_ROOT, name);
    await assertNoLinks(REPOSITORY_ROOT, path);
    outputs[name] = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
  }
  // Hash verification only: never decode videos or infer landmarks here.
  const files = await collectSourceFiles();
  verifyBaseline(files);
  const summary = validateAuditPackage(outputs, files);
  console.log(JSON.stringify({ result: "PASS", outputs: OUTPUT_NAMES.length, sourceFiles: files.length, inventoryRecords: summary.inventoryRecords, distinctMetadataRows: summary.csvRows, mappingCounts: summary.mappingCountsByMetadataRow, hashes: "all source and artifact hashes verified" }, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Audit verification failed");
  process.exitCode = 1;
});

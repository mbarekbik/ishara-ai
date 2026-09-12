import { basename, dirname } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { MetadataRow, VideoRecord } from "./contracts.ts";
import { mapRows, parseMetadataCsv } from "./mapping.ts";
import { buildAuditPackage, OUTPUT_NAMES } from "./auditPackage.ts";
import { validateAuditPackage } from "./validation.ts";
import { assertNoLinks, boundedPath, collectSourceFiles, OUTPUT_ROOT, probeVideo, REPOSITORY_ROOT, toolVersions, verifyBaseline } from "./sourceFiles.ts";

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("This pinned audit accepts no path overrides or positional arguments");
  await assertNoLinks(REPOSITORY_ROOT, OUTPUT_ROOT);
  const files = await collectSourceFiles();
  verifyBaseline(files);
  console.log("Known video and CSV aggregate digests matched. Recovering per-file inventory properties without repeating the full decode.");
  const rows: MetadataRow[] = [];
  for (const file of files.filter(f => f.relativePath.startsWith("metadata/"))) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file.absolutePath));
    rows.push(...parseMetadataCsv(text, file.relativePath, basename(file.relativePath, ".csv")));
  }
  const videoFiles = files.filter(f => f.relativePath.startsWith("videos/"));
  const videos: VideoRecord[] = new Array(videoFiles.length);
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < videoFiles.length) {
      const index = next++;
      const file = videoFiles[index];
      const parts = file.relativePath.split("/");
      if (parts.length !== 3) throw new Error("Unexpected nested category layout; review before mapping");
      videos[index] = { relativePath: file.relativePath, category: parts[1], filename: parts[2], size: file.size, sha256: file.sha256, media: await probeVideo(file) };
      completed += 1;
      if (completed % 500 === 0) console.log(`Media-property records: ${completed}/${videoFiles.length}`);
    }
  }));
  let auditDate = new Date().toISOString().slice(0, 10);
  const summaryPath = boundedPath(OUTPUT_ROOT, "summary.json");
  await assertNoLinks(REPOSITORY_ROOT, summaryPath);
  try {
    const previous = JSON.parse(await readFile(summaryPath, "utf8")) as { auditDate?: string };
    if (previous.auditDate && /^\d{4}-\d{2}-\d{2}$/u.test(previous.auditDate)) auditDate = previous.auditDate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Existing summary is invalid; refusing to overwrite it", { cause: error });
  }
  const mappings = mapRows(rows, videos);
  const input = { rows, videos, files, mappings: mappings.records, versions: await toolVersions(), auditDate };
  const outputs = buildAuditPackage(input);
  const summary = validateAuditPackage(outputs, files);
  const repeated = buildAuditPackage(input);
  for (const name of OUTPUT_NAMES) if (outputs[name] !== repeated[name]) throw new Error(`Nondeterministic output: ${name}`);
  // Verify immutable source bytes again before publishing any artifacts.
  verifyBaseline(await collectSourceFiles());
  await assertNoLinks(REPOSITORY_ROOT, OUTPUT_ROOT);
  await mkdir(OUTPUT_ROOT, { recursive: true });
  // The summary is the commit marker: consumers also verify its artifact hashes.
  const order = [...OUTPUT_NAMES.filter(n => n !== "summary.json"), "summary.json"] as const;
  for (const name of order) {
    const target = boundedPath(OUTPUT_ROOT, name);
    const staging = boundedPath(OUTPUT_ROOT, `.pending-${name}`);
    await assertNoLinks(REPOSITORY_ROOT, target);
    await assertNoLinks(REPOSITORY_ROOT, staging);
    try {
      await writeFile(staging, outputs[name], { encoding: "utf8", flag: "wx" });
      await rename(staging, target);
    } catch (error) {
      // Only remove the exact generated staging file owned by this invocation.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(staging).catch(() => undefined);
      throw error;
    }
  }
  console.log(JSON.stringify({ outputDirectory: dirname(summaryPath), files: OUTPUT_NAMES.length, mappingCounts: summary.mappingCountsByMetadataRow, records: summary.inventoryRecords, curationEligibleRows: summary.usableForLaterCurationRows, sourceIntegrity: "MATCHED_KNOWN_DIGESTS" }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Audit export failed");
  process.exitCode = 1;
});

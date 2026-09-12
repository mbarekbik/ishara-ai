import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SourceFile } from "./sourceFiles.ts";
import { boundedPath, inventoryDigest, REPOSITORY_ROOT, sha256, verifyBaseline } from "./sourceFiles.ts";
import type { VideoRecord } from "./contracts.ts";
import { mapRows, parseMetadataCsv } from "./mapping.ts";
import { buildAuditPackage } from "./auditPackage.ts";

test("source path boundary rejects root, traversal, and sibling-prefix paths", () => {
  for (const path of ["", "..", "../ishara-ai-neighbor/private", "data/../../escape"]) {
    assert.throws(() => boundedPath(REPOSITORY_ROOT, path), /inside/u);
  }
  assert(boundedPath(REPOSITORY_ROOT, "data/scope5/audit/report.md").startsWith(REPOSITORY_ROOT));
});

test("aggregate format preserves Arabic composition, UTF-8 bytes and ordinal paths", () => {
  const files: SourceFile[] = [
    { relativePath: "videos/آ.mp4", absolutePath: "", size: 1, sha256: "b".repeat(64) },
    { relativePath: "videos/آ.mp4", absolutePath: "", size: 2, sha256: "a".repeat(64) },
  ];
  const canonical = `videos/آ.mp4\0${1}\0${"b".repeat(64)}\nvideos/آ.mp4\0${2}\0${"a".repeat(64)}\n`;
  assert.equal(inventoryDigest(files), createHash("sha256").update(canonical, "utf8").digest("hex"));
  assert.equal(inventoryDigest(files), inventoryDigest([...files].reverse()));
  assert.notEqual(inventoryDigest(files), inventoryDigest(files.map(f => ({ ...f, relativePath: f.relativePath.normalize("NFC") }))));
  assert.throws(() => verifyBaseline(files), /STOP/u);
});

test("package counts ambiguous rows once, retains candidates, quarantines suspicious labels, and is deterministic", () => {
  const header = "video_name;sign_label;signer_id;duration_seconds;frame_rate;frame_count;resolution;file_path;file_size_bytes";
  const csv = `${header}\nفِنَاءٌ (2);فِنَاءٌ;signer_1;2;25;50;460x460;/drive/فِنَاءٌ (2).mp4;100\nفِنَاءٌ (3);فِنَاءٌ;signer_1;2;25;50;460x460;/drive/فِنَاءٌ (3).mp4;100\nُ;ُ;signer_2;2;25;50;460x460;/drive/ُ.mp4;100\n`;
  const rows = parseMetadataCsv(csv, "metadata/Diverse.csv", "Diverse");
  const videos: VideoRecord[] = ["فِنَاءٌ(1).mp4", "فِنَاءٌ(2).mp4", "ُ.mp4"].map((filename, i) => ({
    relativePath: `videos/Diverse/${filename}`, filename, category: "Diverse", size: 100,
    sha256: (i < 2 ? "a" : "b").repeat(64),
    media: { readable: true, duration: 2, frameRate: 25, frameRateRational: "25/1", frameCount: 50, width: 460, height: 460 },
  }));
  const files = videos.map(v => ({ relativePath: v.relativePath, absolutePath: "", size: v.size, sha256: v.sha256 }));
  const input = { rows, videos, files, mappings: mapRows(rows, videos).records, versions: { node: "test" }, auditDate: "2026-09-09" };
  const output = buildAuditPackage(input);
  const summary = JSON.parse(output["summary.json"]);
  assert.equal(summary.inventoryRecords, 5);
  assert.equal(summary.mappingCountsByMetadataRow.AMBIGUOUS, 2);
  assert.equal(summary.usableForLaterCurationRows, 0);
  const records = output["inventory.jsonl"].trimEnd().split("\n").map(line => JSON.parse(line));
  assert.equal(records.filter(r => r.matchStatus === "AMBIGUOUS").length, 4);
  assert(records.every(r => r.usableForLaterCuration === false && r.reviewRequired === true));
  const duplicate = JSON.parse(output["duplicate-content.json"]).groups[0];
  assert.equal(duplicate.csvRows.length, 2);
  assert.equal(duplicate.mappingImplication, "AMBIGUOUS_FILENAME_IDENTITY");
  for (const [name, digest] of Object.entries(summary.outputSHA256)) {
    assert.equal(sha256(output[name as keyof typeof output]), digest);
  }
  assert.deepEqual(output, buildAuditPackage({ ...input, rows: [...rows].reverse(), videos: [...videos].reverse(), files: [...files].reverse(), mappings: [...input.mappings].reverse() }));
});

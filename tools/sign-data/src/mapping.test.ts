import assert from "node:assert/strict";
import test from "node:test";
import type { MetadataRow, VideoRecord } from "./contracts.ts";
import { compareMedia, diagnosticCopyStem, mapRows, parseMetadataCsv } from "./mapping.ts";

const HEADER = "video_name;sign_label;sign_label_en;signer_id;duration_seconds;frame_rate;frame_count;resolution;file_path;file_size_bytes";
function row(filename = "أَبٌ.mp4", sourceRow = 2, category = "Diverse"): MetadataRow {
  return { sourceCsv: `metadata/${category}.csv`, sourceRow, category, raw: {},
    metadataFilePath: `/content/drive/MyDrive/${filename}`, metadataFilename: filename,
    rawSignLabel: filename.slice(0, -4), englishGloss: "father", declaredSignerId: "signer_1",
    durationMetadata: 2, frameRateMetadata: 25, frameCountMetadata: 50,
    resolutionMetadata: { width: 460, height: 460 }, fileSizeMetadata: 100 };
}
function video(filename = "أَبٌ.mp4", category = "Diverse"): VideoRecord {
  return { relativePath: `videos/${category}/${filename}`, filename, category, size: 100, sha256: "a".repeat(64),
    media: { readable: true, duration: 2, frameRate: 25, frameRateRational: "25/1", frameCount: 50, width: 460, height: 460 } };
}

test("CSV preserves Arabic composition, diacritics, quoted semicolons and source lines", () => {
  const rawLabel = "أَبٌ";
  const csv = `\uFEFF${HEADER}\r\n${rawLabel};${rawLabel};"father;\r\n""parent""";signer_1;2;25;50;460x460;/content/drive/${rawLabel}.mp4;100\r\nب;ب;other;signer_2;2;25;50;460x460;/content/drive/ب.mp4;100\r\n`;
  const rows = parseMetadataCsv(csv, "metadata/test.csv", "test");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rawSignLabel, rawLabel);
  assert.notEqual(rows[0].rawSignLabel, rawLabel.normalize("NFC"));
  assert.equal(rows[0].englishGloss, 'father;\r\n"parent"');
  assert.equal(rows[0].sourceRow, 2);
  assert.equal(rows[1].sourceRow, 4);
});

test("CSV accepts missing English column, not invented glosses", () => {
  const csv = `${HEADER.replace(";sign_label_en", "")}\n4;4;signer_1;2;25;50;460x460;/drive/4.mp4;100`;
  assert.equal(parseMetadataCsv(csv, "Numbers.csv", "Numbers")[0].englishGloss, null);
});

test("CSV rejects malformed quoting, row widths, schemas, and numeric data", () => {
  for (const csv of [
    `${HEADER}\n"unclosed`,
    `${HEADER}\n"a"unexpected;x`,
    `${HEADER}\na"bad;x`,
    `${HEADER}\na;b`,
    `${HEADER}\na;b;c;s;NaN;25;50;460x460;/a.mp4;100`,
    `${HEADER}\na;b;c;s;2;25;50.5;460x460;/a.mp4;100`,
    `${HEADER}\na;b;c;s;2;25;50;0x460;/a.mp4;100`,
    "video_name;video_name\na;a",
  ]) assert.throws(() => parseMetadataCsv(csv, "bad.csv", "bad"), /bad.csv/);
});

test("exact mapping preserves names and separately reports broken media", () => {
  const source = row();
  const local = video();
  local.media.readable = false;
  const result = mapRows([source], [local]);
  assert.equal(result.records[0].status, "EXACT");
  assert.equal(result.records[0].comparison?.supportsAssociation, false);
  assert.equal(result.records[0].metadata, source);
});

test("Unicode equivalence is diagnostic only and requires properties", () => {
  const source = row();
  const local = video(source.metadataFilename.normalize("NFC"));
  const result = mapRows([source], [local]);
  assert.equal(result.records[0].status, "UNICODE_EQUIVALENT");
  assert.equal(result.records[0].unicodeComparisonRule, "NFC");
  assert.equal(result.records[0].metadata?.metadataFilename, source.metadataFilename);
  assert.equal(result.records[0].video?.filename, local.filename);
  local.size += 1;
  assert.equal(mapRows([source], [local]).records.filter((entry) => entry.status === "UNMATCHED").length, 2);
});

test("Unicode collisions remain ambiguous instead of greedily claiming a video", () => {
  const name = "أب.mp4";
  const rows = [row(name.normalize("NFD"), 2), row(name.normalize("NFD"), 3)];
  const result = mapRows(rows, [video(name)]);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((entry) => entry.status === "AMBIGUOUS"));
  assert.deepEqual(result.unmatchedVideos, []);
});

test("copy suffix mapping requires mutual uniqueness, not duplicate content", () => {
  const result = mapRows([row("قَادَ (1) (1).mp4")], [video("قَادَ(1).mp4")]);
  assert.equal(result.records[0].status, "DETERMINISTIC_NONEXACT");
  const courtyard = "فِنَاءٌ خَلْفِيٌّ";
  const ambiguous = mapRows([row(`${courtyard} (3).mp4`, 2), row(`${courtyard} (2).mp4`, 3)],
    [video(`${courtyard}(1).mp4`), video(`${courtyard}(2).mp4`)]);
  assert.equal(ambiguous.records.length, 4);
  assert.ok(ambiguous.records.every((entry) => entry.status === "AMBIGUOUS"));
});

test("one row with multiple candidate copies remains ambiguous", () => {
  const result = mapRows([row("قَادَ (3).mp4")], [video("قَادَ(1).mp4"), video("قَادَ(2).mp4")]);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((entry) => entry.status === "AMBIGUOUS"));
});

test("exact matches leave the candidate pool before weaker matching", () => {
  const result = mapRows([row("قَادَ(1).mp4", 2), row("قَادَ (3).mp4", 3)], [video("قَادَ(1).mp4"), video("قَادَ(2).mp4")]);
  assert.deepEqual(result.records.map((entry) => entry.status), ["EXACT", "DETERMINISTIC_NONEXACT"]);
});

test("no cross-category or linguistic identifier matching", () => {
  assert.equal(mapRows([row()], [video("أَبٌ.mp4", "Letters")]).records.length, 2);
  assert.equal(diagnosticCopyStem("فِي (إِشَارَة 1) (2).mp4"), "فِي (إِشَارَة 1)".normalize("NFC"));
  assert.notEqual(diagnosticCopyStem("فِي (إِشَارَة 1).mp4"), diagnosticCopyStem("فِي (إِشَارَة 2).mp4"));
  assert.notEqual(diagnosticCopyStem("بَ.mp4"), diagnosticCopyStem("بُ.mp4"));
  assert.ok(mapRows([row("فِي (إِشَارَة 1) (2).mp4")], [video("فِي (إِشَارَة 2)(1).mp4")]).records.every((entry) => entry.status === "UNMATCHED"));
});

test("media comparison separates tolerances, substantive differences and absent evidence", () => {
  const local = video();
  local.media.duration = 2.03;
  local.media.frameRate = 25.01;
  const accepted = compareMedia(row(), local);
  assert.equal(accepted.supportsAssociation, true);
  assert.equal(accepted.differences.length, 2);
  assert.ok(accepted.differences.every((entry) => entry.kind === "ACCEPTED_TOLERANCE"));
  local.media.frameCount = null;
  assert.equal(compareMedia(row(), local).supportsAssociation, false);
  assert.equal(compareMedia(row(), local).differences.at(-1)?.kind, "UNAVAILABLE");
  local.media.frameCount = 51;
  assert.equal(compareMedia(row(), local).differences.at(-1)?.kind, "SUBSTANTIVE");
});

test("deterministic ordering is independent of input traversal", () => {
  const rows = [row("ب.mp4", 3), row("أ.mp4", 2)];
  const videos = [video("ب.mp4"), video("أ.mp4")];
  assert.deepEqual(mapRows(rows, videos), mapRows([...rows].reverse(), [...videos].reverse()));
});

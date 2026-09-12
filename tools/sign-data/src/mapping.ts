import type { MediaComparison, MediaDifference, MetadataRow, MappingRecord, MappingResult, MatchStatus, VideoRecord } from "./contracts.ts";

export function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Strict semicolon CSV reader with physical source-line provenance. */
function csvRecords(text: string, source: string): { values: string[]; line: number }[] {
  const records: { values: string[]; line: number }[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let recordLine = 1;
  let populated = false;
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const fail = (message: string): never => { throw new Error(`${source}:${line}: ${message}`); };
  const finishField = () => { values.push(field); field = ""; closedQuote = false; };
  const finishRecord = () => {
    finishField();
    records.push({ values, line: recordLine });
    values = [];
    populated = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else {
        field += character;
        if (character === "\n") line += 1;
        else if (character === "\r" && input[index + 1] !== "\n") line += 1;
      }
      continue;
    }
    if (character === ";") { finishField(); populated = true; continue; }
    if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      line += 1;
      recordLine = line;
      continue;
    }
    if (closedQuote) fail("Unexpected content after closing quote");
    if (character === '"') {
      if (field !== "") fail("Quote inside an unquoted field");
      quoted = true;
    } else field += character;
    populated = true;
  }
  if (quoted) fail("Unterminated quoted field");
  if (populated || values.length > 0 || field !== "" || closedQuote) finishRecord();
  return records;
}

const REQUIRED_COLUMNS = ["video_name", "sign_label", "signer_id", "duration_seconds", "frame_rate", "frame_count", "resolution", "file_path", "file_size_bytes"];

/** Preserve raw fields and Arabic spelling; numeric failures fail explicitly. */
export function parseMetadataCsv(text: string, sourceCsv: string, category: string): MetadataRow[] {
  const records = csvRecords(text, sourceCsv);
  const header = records.shift();
  if (!header) throw new Error(`${sourceCsv}: Missing CSV header`);
  if (new Set(header.values).size !== header.values.length ||
      (header.values.length !== 9 && header.values.length !== 10) ||
      REQUIRED_COLUMNS.some((name) => !header.values.includes(name)) ||
      header.values.some((name) => !REQUIRED_COLUMNS.includes(name) && name !== "sign_label_en")) {
    throw new Error(`${sourceCsv}: Expected the published 9- or 10-column metadata schema`);
  }
  return records.map(({ values, line }) => {
    const prefix = `${sourceCsv}:${line}`;
    if (values.length !== header.values.length) throw new Error(`${prefix}: Expected ${header.values.length} fields; received ${values.length}`);
    const raw = Object.fromEntries(header.values.map((name, index) => [name, values[index]]));
    const number = (name: string, integer = false): number => {
      const value = raw[name];
      const parsed = Number(value);
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isSafeInteger(parsed))) {
        throw new Error(`${prefix}: Invalid positive ${integer ? "integer" : "number"} in ${name}`);
      }
      return parsed;
    };
    for (const name of ["video_name", "sign_label", "signer_id", "file_path"]) {
      if (raw[name] === "") throw new Error(`${prefix}: Empty ${name}`);
    }
    const resolution = /^(\d+)x(\d+)$/.exec(raw.resolution);
    if (!resolution || Number(resolution[1]) <= 0 || Number(resolution[2]) <= 0 || !Number.isSafeInteger(Number(resolution[1])) || !Number.isSafeInteger(Number(resolution[2]))) {
      throw new Error(`${prefix}: Invalid resolution`);
    }
    const metadataFilename = raw.file_path.split(/[\\/]/u).at(-1) ?? "";
    if (!metadataFilename.endsWith(".mp4")) throw new Error(`${prefix}: file_path must identify an MP4 filename`);
    return {
      sourceCsv, sourceRow: line, category, raw,
      metadataFilePath: raw.file_path, metadataFilename,
      rawSignLabel: raw.sign_label, englishGloss: raw.sign_label_en ?? null,
      declaredSignerId: raw.signer_id,
      durationMetadata: number("duration_seconds"), frameRateMetadata: number("frame_rate"),
      frameCountMetadata: number("frame_count", true),
      resolutionMetadata: { width: Number(resolution[1]), height: Number(resolution[2]) },
      fileSizeMetadata: number("file_size_bytes", true),
    };
  });
}

export function compareMedia(metadata: MetadataRow, video: VideoRecord): MediaComparison {
  const differences: MediaDifference[] = [];
  if (!video.media.readable) differences.push({ field: "readable", metadata: true, actual: false, delta: null, tolerance: null, kind: "SUBSTANTIVE" });
  const compare = (field: MediaDifference["field"], expected: number, actual: number | null, tolerance: number) => {
    if (actual === null || !Number.isFinite(actual) || actual <= 0) {
      differences.push({ field, metadata: expected, actual, delta: null, tolerance, kind: "UNAVAILABLE" });
      return;
    }
    const delta = actual - expected;
    if (delta === 0) return;
    differences.push({ field, metadata: expected, actual, delta, tolerance,
      kind: Math.abs(delta) <= tolerance ? "ACCEPTED_TOLERANCE" : "SUBSTANTIVE" });
  };
  const fps = video.media.frameRate && video.media.frameRate > 0 ? video.media.frameRate : metadata.frameRateMetadata;
  compare("duration", metadata.durationMetadata, video.media.duration, Math.max(0.04, 1 / fps + 0.005));
  compare("frameRate", metadata.frameRateMetadata, video.media.frameRate, 0.02);
  compare("frameCount", metadata.frameCountMetadata, video.media.frameCount, 0);
  compare("width", metadata.resolutionMetadata.width, video.media.width, 0);
  compare("height", metadata.resolutionMetadata.height, video.media.height, 0);
  compare("fileSize", metadata.fileSizeMetadata, video.size, 0);
  return { supportsAssociation: differences.every((difference) => difference.kind === "ACCEPTED_TOLERANCE"), differences };
}

/** Candidate discovery only: remove trailing numeric copy suffixes, never sign identifiers. */
export function diagnosticCopyStem(filename: string): string {
  return filename.replace(/\.mp4$/u, "").normalize("NFC").replace(/(?:\s*\([0-9]+\))+\s*$/u, "");
}

function rowCompare(left: MetadataRow, right: MetadataRow): number {
  return ordinalCompare(left.sourceCsv, right.sourceCsv) || left.sourceRow - right.sourceRow;
}

/** Conservative bipartite matching: accept only mutually unique associations. */
export function mapRows(metadata: readonly MetadataRow[], videos: readonly VideoRecord[]): MappingResult {
  const pendingRows = new Set([...metadata].sort(rowCompare));
  const pendingVideos = new Set([...videos].sort((left, right) => ordinalCompare(left.relativePath, right.relativePath)));
  const records: MappingRecord[] = [];
  const stage = (status: MatchStatus, compatible: (row: MetadataRow, video: VideoRecord) => boolean, requireProperties: boolean, reason: string) => {
    const graph = new Map<MetadataRow, VideoRecord[]>();
    const references = new Map<VideoRecord, number>();
    for (const row of pendingRows) {
      const candidates = [...pendingVideos].filter((video) => row.category === video.category && compatible(row, video) && (!requireProperties || compareMedia(row, video).supportsAssociation));
      if (candidates.length === 0) continue;
      graph.set(row, candidates);
      for (const video of candidates) references.set(video, (references.get(video) ?? 0) + 1);
    }
    for (const [row, candidates] of graph) {
      const unique = candidates.length === 1 && references.get(candidates[0]) === 1;
      for (const video of candidates) {
        records.push({
          metadata: row, video, status: unique ? status : "AMBIGUOUS",
          reason: unique ? reason : `Multiple plausible row/file associations remain at the ${status} comparison stage; content identity does not establish variant identity`,
          ...(status === "EXACT" ? {} : { unicodeComparisonRule: "NFC" as const }),
          comparison: compareMedia(row, video),
        });
        pendingVideos.delete(video);
      }
      // Ambiguity is retained, not resolved by applying a weaker filename rule.
      pendingRows.delete(row);
    }
  };
  stage("EXACT", (row, video) => row.metadataFilename === video.filename, false, "Unchanged category and filename are exactly equal; media verification is recorded separately");
  stage("UNICODE_EQUIVALENT", (row, video) => row.metadataFilename.normalize("NFC") === video.filename.normalize("NFC"), true,
    "Unique same-category NFC-equivalent filename and agreeing media properties; both original strings are preserved");
  stage("DETERMINISTIC_NONEXACT", (row, video) => diagnosticCopyStem(row.metadataFilename) === diagnosticCopyStem(video.filename), true,
    "Mutually unique same-category candidate after diagnostic NFC comparison and removal of trailing numeric copy suffixes; size, frames, resolution, duration and FPS agree; source names are unchanged");
  const unmatchedRows = [...pendingRows];
  const unmatchedVideos = [...pendingVideos];
  for (const row of unmatchedRows) records.push({ metadata: row, video: null, status: "UNMATCHED", reason: "No safe filename candidate with the required media evidence; no correction inferred", comparison: null });
  for (const video of unmatchedVideos) records.push({ metadata: null, video, status: "UNMATCHED", reason: "No accepted or ambiguous metadata association", comparison: null });
  records.sort((left, right) => {
    if (left.metadata && right.metadata) return rowCompare(left.metadata, right.metadata) || ordinalCompare(left.video?.relativePath ?? "", right.video?.relativePath ?? "");
    if (left.metadata) return -1;
    if (right.metadata) return 1;
    return ordinalCompare(left.video?.relativePath ?? "", right.video?.relativePath ?? "");
  });
  return { records, unmatchedRows, unmatchedVideos };
}

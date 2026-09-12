/** Raw strings are evidence: comparisons must never replace them with normalized text. */
export interface MetadataRow {
  sourceCsv: string;
  /** Physical CSV line number, including the header. */
  sourceRow: number;
  category: string;
  raw: Readonly<Record<string, string>>;
  metadataFilePath: string;
  metadataFilename: string;
  rawSignLabel: string;
  englishGloss: string | null;
  declaredSignerId: string;
  durationMetadata: number;
  frameRateMetadata: number;
  frameCountMetadata: number;
  resolutionMetadata: { width: number; height: number };
  fileSizeMetadata: number;
}

export interface VideoRecord {
  /** Unchanged path relative to the dataset root, using forward slashes. */
  relativePath: string;
  filename: string;
  category: string;
  size: number;
  sha256: string;
  media: {
    readable: boolean;
    duration: number | null;
    frameRate: number | null;
    frameRateRational: string | null;
    frameCount: number | null;
    width: number | null;
    height: number | null;
    codec?: string;
    container?: string;
    frameCountSource?: "container-header" | "counted-decode";
    error?: string;
  };
}

export type MatchStatus =
  | "EXACT"
  | "UNICODE_EQUIVALENT"
  | "DETERMINISTIC_NONEXACT"
  | "AMBIGUOUS"
  | "UNMATCHED";

export interface MediaDifference {
  field: "readable" | "duration" | "frameRate" | "frameCount" | "width" | "height" | "fileSize";
  metadata: number | boolean;
  actual: number | boolean | null;
  delta: number | null;
  tolerance: number | null;
  kind: "ACCEPTED_TOLERANCE" | "SUBSTANTIVE" | "UNAVAILABLE";
}

export interface MediaComparison {
  supportsAssociation: boolean;
  differences: MediaDifference[];
}

export interface MappingRecord {
  metadata: MetadataRow | null;
  video: VideoRecord | null;
  status: MatchStatus;
  reason: string;
  unicodeComparisonRule?: "NFC";
  comparison: MediaComparison | null;
}

export interface MappingResult {
  records: MappingRecord[];
  /** Rows with no accepted or ambiguous candidate. Ambiguous rows are in records. */
  unmatchedRows: MetadataRow[];
  /** Videos with no accepted or ambiguous candidate. Ambiguous videos are in records. */
  unmatchedVideos: VideoRecord[];
}

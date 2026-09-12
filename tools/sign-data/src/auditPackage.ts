import type { MappingRecord, MetadataRow, VideoRecord } from "./contracts.ts";
import { EXPECTED, ordinal, sha256, SOURCE_ROOT } from "./sourceFiles.ts";
import type { SourceFile } from "./sourceFiles.ts";

export const OUTPUT_NAMES = ["summary.json", "inventory.jsonl", "filename-mismatches.json", "duplicate-content.json", "metadata-discrepancies.json", "label-inventory.json", "signer-coverage.csv", "checksums.sha256", "report.md"] as const;
export type AuditOutputs = Record<typeof OUTPUT_NAMES[number], string>;
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const unique = (values: string[]): string[] => [...new Set(values)].sort(ordinal);
const rowKey = (row: MetadataRow): string => `${row.sourceCsv}:${row.sourceRow}`;
const suspiciousLabel = (label: string): boolean => /^\p{M}+$/u.test(label);
function group<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    result.set(name, [...(result.get(name) ?? []), value]);
  }
  return new Map([...result].sort(([a], [b]) => ordinal(a, b)));
}
function csvField(value: unknown): string {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildAuditPackage(input: {
  rows: MetadataRow[];
  videos: VideoRecord[];
  files: SourceFile[];
  mappings: MappingRecord[];
  versions: Record<string, string>;
  auditDate: string;
}): AuditOutputs {
  const { versions, auditDate } = input;
  const rows = [...input.rows].sort((a, b) => ordinal(a.sourceCsv, b.sourceCsv) || a.sourceRow - b.sourceRow);
  const videos = [...input.videos].sort((a, b) => ordinal(a.relativePath, b.relativePath));
  const files = [...input.files].sort((a, b) => ordinal(a.relativePath, b.relativePath));
  const mappings = [...input.mappings].sort((a, b) => ordinal(a.metadata?.sourceCsv ?? "~", b.metadata?.sourceCsv ?? "~") || (a.metadata?.sourceRow ?? 0) - (b.metadata?.sourceRow ?? 0) || ordinal(a.video?.relativePath ?? "", b.video?.relativePath ?? ""));
  const byContent = group(videos, video => video.sha256);
  const duplicates = [...byContent].filter(([, members]) => members.length > 1).map(([hash, members]) => {
    const involved = mappings.filter(m => m.video?.sha256 === hash);
    const ambiguous = involved.some(m => m.status === "AMBIGUOUS" || m.status === "UNMATCHED");
    const labels = unique(involved.flatMap(m => m.metadata ? [m.metadata.rawSignLabel] : []));
    return {
      groupId: `sha256:${hash}`, sha256: hash, fileCount: members.length, excessCopies: members.length - 1,
      bytesEach: members[0].size,
      files: members.map(v => v.relativePath).sort(ordinal),
      categories: unique(members.map(v => v.category)), labels,
      csvRows: [...group(involved.filter(m => m.metadata !== null), m => rowKey(m.metadata!))].map(([id, pairs]) => ({
        id, sourceCsv: pairs[0].metadata!.sourceCsv, sourceRow: pairs[0].metadata!.sourceRow,
        rawSignLabel: pairs[0].metadata!.rawSignLabel,
        candidateFiles: unique(pairs.flatMap(p => p.video ? [p.video.relativePath] : [])),
      })),
      duplicationScope: new Set(members.map(v => v.category)).size > 1 ? "CROSS_CATEGORY" : "WITHIN_CATEGORY",
      mappingImplication: ambiguous ? "AMBIGUOUS_FILENAME_IDENTITY" : labels.length > 1 ? "CONTENT_IDENTICAL_DISTINCT_LABELS_REQUIRE_REVIEW" : "CONTENT_IDENTICAL_MAPPED_FILES_NO_LINGUISTIC_DECISION",
      canonicalFileSelected: false,
    };
  });
  const duplicateHashes = new Set(duplicates.map(g => g.sha256));
  const inventory = mappings.map(m => {
    const row = m.metadata;
    const video = m.video;
    const accepted = ["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT"].includes(m.status) && m.comparison?.supportsAssociation === true;
    const reviewReasons = unique([
      ...(row ? ["DECLARED_SIGNER_ID_UNVERIFIED", "LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED"] : ["VIDEO_WITHOUT_METADATA"]),
      ...(row && suspiciousLabel(row.rawSignLabel) ? ["COMBINING_MARK_ONLY_LABEL"] : []),
      ...(row && row.englishGloss === null ? ["ENGLISH_GLOSS_COLUMN_ABSENT"] : []),
      ...(video && duplicateHashes.has(video.sha256) ? ["DUPLICATE_CONTENT"] : []),
      ...(!accepted ? ["FILENAME_OR_MEDIA_REVIEW_REQUIRED"] : []),
    ]);
    return {
      sourceCsv: row?.sourceCsv ?? null, sourceRow: row?.sourceRow ?? null,
      category: row?.category ?? video?.category ?? null,
      metadataFilePath: row?.metadataFilePath ?? null, metadataFilename: row?.metadataFilename ?? null,
      localVideoRelativePath: video?.relativePath ?? null,
      rawSignLabel: row?.rawSignLabel ?? null, englishGloss: row?.englishGloss ?? null,
      englishGlossColumnPresent: row ? Object.hasOwn(row.raw, "sign_label_en") : false,
      declaredSignerId: row?.declaredSignerId ?? null,
      durationMetadata: row?.durationMetadata ?? null, durationActual: video?.media.duration ?? null,
      frameRateMetadata: row?.frameRateMetadata ?? null, frameRateActual: video?.media.frameRate ?? null,
      frameRateActualRational: video?.media.frameRateRational ?? null,
      frameCountMetadata: row?.frameCountMetadata ?? null, frameCountActual: video?.media.frameCount ?? null,
      frameCountActualEvidence: video?.media.frameCountSource ?? null,
      resolutionMetadata: row?.resolutionMetadata ?? null,
      resolutionActual: video ? { width: video.media.width, height: video.media.height } : null,
      fileSizeMetadata: row?.fileSizeMetadata ?? null, fileSizeActual: video?.size ?? null,
      sha256: video?.sha256 ?? null,
      contentDuplicateGroupId: video && duplicateHashes.has(video.sha256) ? `sha256:${video.sha256}` : null,
      codec: video?.media.codec ?? null, container: video?.media.container ?? null,
      matchStatus: m.status, matchReason: m.reason,
      unicodeComparisonRule: m.unicodeComparisonRule ?? null,
      mediaComparison: m.comparison,
      usableForLaterCuration: Boolean(accepted && row && !suspiciousLabel(row.rawSignLabel)),
      reviewRequired: reviewReasons.length > 0, reviewReasons,
    };
  });
  const rowsToMappings = group(mappings.filter(m => m.metadata !== null), m => rowKey(m.metadata!));
  const counts: Record<string, number> = Object.fromEntries(["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT", "AMBIGUOUS", "UNMATCHED"].map(status => [status, [...rowsToMappings.values()].filter(pairs => pairs[0].status === status).length]));
  const acceptedMappings = mappings.filter(m => ["EXACT", "UNICODE_EQUIVALENT", "DETERMINISTIC_NONEXACT"].includes(m.status) && m.comparison?.supportsAssociation === true);
  const unresolvedMappings = mappings.filter(m => m.status === "AMBIGUOUS" || m.status === "UNMATCHED");
  const filenameIssues = inventory.filter(r => r.matchStatus !== "EXACT");
  const differences = inventory.flatMap(r => (r.mediaComparison?.differences ?? []).map(d => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, localVideoRelativePath: r.localVideoRelativePath, matchStatus: r.matchStatus, ...d })));
  const labels = [...group(rows, row => row.rawSignLabel)].map(([rawSignLabel, members]) => {
    const ids = new Set(members.map(rowKey));
    const related = inventory.filter(r => r.sourceCsv && r.sourceRow && ids.has(`${r.sourceCsv}:${r.sourceRow}`));
    return {
      rawSignLabel, rowCount: members.length, categories: unique(members.map(r => r.category)),
      declaredSignerIds: unique(members.map(r => r.declaredSignerId)),
      englishGlosses: unique(members.flatMap(r => r.englishGloss === null ? [] : [r.englishGloss])),
      sourceFilenames: members.map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, filename: r.metadataFilename })),
      duplicateContentGroupIds: unique(related.flatMap(r => r.contentDuplicateGroupId ? [r.contentDuplicateGroupId] : [])),
      combiningMarkOnly: suspiciousLabel(rawSignLabel),
      reviewRequired: true,
      reviewReasons: ["LINGUISTIC_LABEL_AND_VARIANTS_UNVERIFIED", "DECLARED_SIGNER_ID_UNVERIFIED", ...(suspiciousLabel(rawSignLabel) ? ["COMBINING_MARK_ONLY_LABEL"] : [])],
    };
  });
  const assignmentPatterns = [...group(rows, r => r.sourceCsv)].map(([sourceCsv, members]) => {
    const encountered = new Map<string, number>();
    const exceptions: number[] = [];
    for (const row of [...members].sort((a, b) => a.sourceRow - b.sourceRow)) {
      if (!encountered.has(row.rawSignLabel)) encountered.set(row.rawSignLabel, encountered.size);
      if (row.declaredSignerId !== `signer_${encountered.get(row.rawSignLabel)! % 9 + 1}`) exceptions.push(row.sourceRow);
    }
    return { sourceCsv, labelCount: encountered.size, exceptionRows: exceptions };
  });
  const signerRecords = [...group(rows, r => r.declaredSignerId)].map(([declaredSignerId, members]) => ({
    declaredSignerId, rowCount: members.length, exactRawLabelCount: new Set(members.map(r => r.rawSignLabel)).size,
    categories: unique(members.map(r => r.category)), identityStatus: "DECLARED_ONLY_UNVERIFIED",
  }));
  const histogram: Record<string, number> = {};
  for (const label of labels) histogram[label.rowCount] = (histogram[label.rowCount] ?? 0) + 1;
  const categoryCounts = [...group(rows, r => r.category)].map(([category, members]) => ({
    category, csvRows: members.length, videos: videos.filter(v => v.category === category).length,
    mappingCounts: Object.fromEntries(Object.keys(counts).map(status => [status, members.filter(row => rowsToMappings.get(rowKey(row))?.[0].status === status).length])),
  }));
  const fpsCounts: Record<string, number> = {};
  for (const video of videos) fpsCounts[video.media.frameRateRational ?? "unavailable"] = (fpsCounts[video.media.frameRateRational ?? "unavailable"] ?? 0) + 1;
  const summary = {
    schemaVersion: 1, datasetVersion: "mosl-v1", auditDate, tools: versions,
    sourceRoot: SOURCE_ROOT, relativePathBase: "data/scope5/source/mosl-v1", rawDataModified: false,
    csvFiles: files.filter(f => f.relativePath.startsWith("metadata/")).length,
    csvRows: rows.length, mp4Files: videos.length, totalVideoBytes: videos.reduce((n, v) => n + v.size, 0),
    inventoryRecords: inventory.length, mappingCountsByMetadataRow: counts,
    acceptedMappedVideos: new Set(acceptedMappings.flatMap(m => m.video ? [m.video.relativePath] : [])).size,
    unresolvedCandidateVideos: unique(unresolvedMappings.flatMap(m => m.video ? [m.video.relativePath] : [])).length,
    unmappedVideoRecords: mappings.filter(m => m.metadata === null).length,
    missingRowsWithoutAnyCandidate: mappings.filter(m => m.metadata !== null && m.video === null).length,
    usableForLaterCurationRows: new Set(inventory.filter(r => r.usableForLaterCuration).map(r => `${r.sourceCsv}:${r.sourceRow}`)).size,
    exactRawLabels: labels.length, labelSampleHistogram: histogram,
    labelsWithMultipleDeclaredSigners: labels.filter(l => l.declaredSignerIds.length > 1).length,
    declaredSignerCoverage: signerRecords, declaredSignerAssignmentPattern: { formula: "signer_(first-appearance distinct-label index within CSV modulo 9 + 1)", files: assignmentPatterns, identityVerified: false },
    parenthesizedVideoNames: rows.filter(r => /\([^)]*\)/u.test(r.raw.video_name)).length,
    combiningMarkOnlyLabelCount: labels.filter(l => l.combiningMarkOnly).length,
    combiningMarkOnlyRowCount: rows.filter(r => suspiciousLabel(r.rawSignLabel)).length,
    missingEnglishGlossColumnRows: rows.filter(r => !Object.hasOwn(r.raw, "sign_label_en")).length,
    fullDuplicateMetadataRows: rows.length - new Set(rows.map(r => JSON.stringify(r.raw))).size,
    duplicateMetadataFilePaths: rows.length - new Set(rows.map(r => r.metadataFilePath)).size,
    duplicateGroups: duplicates.length, filesInDuplicateGroups: duplicates.reduce((n, d) => n + d.fileCount, 0),
    excessDuplicateCopies: duplicates.reduce((n, d) => n + d.excessCopies, 0), uniqueVideoContents: byContent.size,
    media: {
      currentProbe: "Header/container inspection; full frame counting only if header count unavailable",
      codecs: unique(videos.map(v => v.media.codec ?? "unavailable")),
      resolutions: unique(videos.map(v => `${v.media.width}x${v.media.height}`)), frameRates: fpsCounts,
      durationRangeSeconds: [Math.min(...videos.map(v => v.media.duration!)), Math.max(...videos.map(v => v.media.duration!))],
      summedCurrentFrameCounts: videos.reduce((n, v) => n + v.media.frameCount!, 0),
      priorFullDecode: { carriedForwardOnlyAfterSourceDigestVerification: true, readable: 2216, corruptOrUnreadable: 0, decodedFrames: 222910, tool: "ffprobe 8.0", evidence: "Completed read-only audit in this session; no second full decode performed", priorProbeInventoryDigest: "bbd96c99a4c5c386913c2b24ba441d9cd925c819394e274eddcdda3d76e0a8af" },
    },
    numericDifferences: {
      acceptedToleranceComparisons: differences.filter(d => d.kind === "ACCEPTED_TOLERANCE").length,
      substantiveComparisons: differences.filter(d => d.kind === "SUBSTANTIVE" || d.kind === "UNAVAILABLE").length,
      candidatePairsCountedSeparately: true,
    },
    sourceIntegrity: { videosSHA256: EXPECTED.videoDigest, videosAndCsvSHA256: EXPECTED.datasetDigest, verifiedBeforeAndAfterProbing: true },
    categories: categoryCounts,
    semantics: {
      usableForLaterCuration: "Resolved technical association, valid media, and no combining-mark-only label; NOT linguistic approval or training eligibility",
      reviewRequired: "All rows require linguistic and declared-signer review; ambiguous rows remain unassigned",
      noCanonicalVocabularyOrVerifiedIdentityCreated: true,
    },
    outputSHA256: {} as Record<string, string>,
  };
  const signerCsv = ["declaredSignerId,rowCount,exactRawLabelCount,categories,identityStatus", ...signerRecords.map(s => [s.declaredSignerId, s.rowCount, s.exactRawLabelCount, s.categories.join("|"), s.identityStatus].map(csvField).join(","))].join("\n") + "\n";
  const output: AuditOutputs = {
    "summary.json": "",
    "inventory.jsonl": inventory.map(r => JSON.stringify(r)).join("\n") + "\n",
    "filename-mismatches.json": json({ schemaVersion: 1, policy: "Association metadata only; source strings and files are unchanged. NFC is used only for unique comparison. Suffix candidates require mutual uniqueness among unclaimed files and complete media agreement; content identity never settles ambiguous filename identity.", mappingCountsByMetadataRow: counts, records: filenameIssues }),
    "duplicate-content.json": json({ schemaVersion: 1, groupIdRule: "sha256:<full lowercase SHA-256>", noCanonicalFileSelected: true, groups: duplicates }),
    "metadata-discrepancies.json": json({
      schemaVersion: 1,
      acceptedNumericToleranceDifferences: differences.filter(d => d.kind === "ACCEPTED_TOLERANCE"),
      substantiveDifferences: differences.filter(d => d.kind === "SUBSTANTIVE" || d.kind === "UNAVAILABLE"),
      missingEnglishGlosses: rows.filter(r => r.englishGloss === null).map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, reason: "COLUMN_ABSENT", rawSignLabel: r.rawSignLabel })),
      suspiciousLabels: rows.filter(r => suspiciousLabel(r.rawSignLabel)).map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, rawSignLabel: r.rawSignLabel, codePoints: [...r.rawSignLabel].map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`), reason: "COMBINING_MARK_ONLY; NOT AN UNKNOWN TRAINING CLASS" })),
      originalColabDrivePaths: rows.map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, originalValue: r.metadataFilePath, localPathUsableAsWritten: false })),
      filenameAssociationIssues: filenameIssues.map(r => ({ sourceCsv: r.sourceCsv, sourceRow: r.sourceRow, metadataFilename: r.metadataFilename, localVideoRelativePath: r.localVideoRelativePath, matchStatus: r.matchStatus, matchReason: r.matchReason })),
      mediaPropertyDiscrepancies: differences,
    }),
    "label-inventory.json": json({ schemaVersion: 1, comparison: "EXACT_RAW_LABEL; no normalization or semantic merging", labels }),
    "signer-coverage.csv": signerCsv,
    "checksums.sha256": files.map(f => `${f.sha256}  ${f.relativePath}`).join("\n") + "\n",
    "report.md": `# MoSL v1 local audit\n\nAudit date: ${auditDate}. Source: \`${SOURCE_ROOT}\`.\n\nTools: ${Object.entries(versions).map(([k, v]) => `${k}: ${v}`).join("; ")}. No dependencies installed.\n\n## TECHNICALLY VERIFIED\n\n- ${rows.length} CSV rows; ${videos.length} MP4 files; ${summary.totalVideoBytes} video bytes.\n- Mapping counts are per metadata row: ${Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join("; ")}.\n- ${inventory.length} inventory records: ambiguous rows each retain every candidate; record count is not source-row count.\n- ${summary.acceptedMappedVideos} accepted file associations, ${summary.unresolvedCandidateVideos} unresolved candidate videos; ${summary.missingRowsWithoutAnyCandidate} rows have no candidate.\n- ${duplicates.length} exact-content groups, ${summary.filesInDuplicateGroups} involved files, ${summary.excessDuplicateCopies} excess copies; ${byContent.size} unique contents. No canonical file selected and no duplicate deleted.\n- Current lightweight probes: ${summary.media.resolutions.join(", ")}; ${summary.media.codecs.join(", ")}; durations ${summary.media.durationRangeSeconds.join("–")} seconds; ${summary.media.summedCurrentFrameCounts} frame-count total. Full per-file values and rational FPS are in inventory.jsonl.\n- Prior full-decode result was reused only after both known source digests matched: 2,216 readable; 0 corrupt/unreadable; 222,910 decoded frames. Header counts in this export are explicitly labelled, not presented as a repeated full decode.\n- ${summary.numericDifferences.substantiveComparisons} substantive/unavailable numeric comparison differences. Accepted rounding/tolerance differences remain recorded individually.\n\n## Filename associations\n\nEXACT preserves category and raw filename equality. UNICODE_EQUIVALENT uses unique within-category NFC comparison with supporting properties; both original strings remain unchanged. DETERMINISTIC_NONEXACT uses remaining unclaimed files, unchanged linguistic stem/gesture identifiers, matching numeric properties, and mutual row/file uniqueness. Copy suffix comparison is diagnostic only. All differences are in filename-mismatches.json.\n\nUnresolved rows:\n\n${unique(unresolvedMappings.flatMap(m => m.metadata ? [`- ${rowKey(m.metadata)}: \`${m.metadata.metadataFilename}\``] : [])).join("\n") || "None."}\n\nIdentical courtyard content does not determine the row-to-filename identity. No automatic courtyard assignment was made.\n\n## LINGUISTICALLY / IDENTITY UNVERIFIED\n\n- ${labels.length} exact raw labels, each associated with one DECLARED signer in the supplied metadata. These IDs are not verified human identities.\n- The repeating first-appearance label-index modulo-nine assignment pattern has ${assignmentPatterns.reduce((n, p) => n + p.exceptionRows.length, 0)} exceptions; corrections require authoritative evidence.\n- ${summary.combiningMarkOnlyRowCount} rows across ${summary.combiningMarkOnlyLabelCount} combining-mark-only labels require review. They are not negative/Unknown training samples.\n- Numbers omits the English-gloss column (${summary.missingEnglishGlossColumnRows} rows).\n- ${summary.parenthesizedVideoNames} names have parenthesized suffixes. No linguistic variant, movement type, or canonical vocabulary ID was inferred.\n- ${summary.fullDuplicateMetadataRows} full duplicate CSV rows; ${summary.duplicateMetadataFilePaths} duplicate metadata paths. Original Colab/Drive paths are retained, not treated as local download locations.\n\n## Integrity and reproducibility\n\nRaw MP4 and CSV bytes were read only. Both source digests were checked before probing and again before export. Any mismatch stops publication instead of replacing the known result.\n\n- Videos aggregate SHA-256: \`${EXPECTED.videoDigest}\`\n- Videos plus CSV aggregate SHA-256: \`${EXPECTED.datasetDigest}\`\n\nchecksums.sha256 uses UTF-8, LF, lowercase SHA-256, two spaces, and the unchanged dataset-root-relative path with / separators. Paths are sorted by ordinal UTF-16 comparison; no Unicode normalization or case folding. For the aggregate, concatenate each UTF-8 record as path + NUL + decimal byte size + NUL + lowercase SHA-256 + LF, then SHA-256 the concatenation. summary.json records hashes of the other eight artifacts. The audit date is retained on rerun for stable output.\n\n## Next-phase boundary\n\nThis package supports five-sign vocabulary CURATION and file/annotation review only. usableForLaterCuration identifies technically resolved, non-suspicious records; it does not approve sign meanings, identities, dataset licensing, training, or extraction. All labels still require qualified review. Exclude ambiguous mappings and suspicious labels pending review; keep duplicate groups together for any later split. Source-video usage terms must already cover the intended later work. No landmarks, vocabulary selection, training, model export, or application integration was performed.\n`,
  };
  for (const name of OUTPUT_NAMES.filter(n => n !== "summary.json")) summary.outputSHA256[name] = sha256(output[name]);
  output["summary.json"] = json(summary);
  return output;
}

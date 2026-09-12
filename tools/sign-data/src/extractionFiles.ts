import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readFile, mkdir, writeFile, rename, unlink, link } from "node:fs/promises";
import ts from "typescript";
import { CURATION_ROOT } from "./curationFiles.ts";
import { CURATION_OUTPUT_NAMES } from "./curation.ts";
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT, sha256, SOURCE_ROOT } from "./sourceFiles.ts";
import { parseExtractionInputs, sampleOutputPath, serializeLandmarkFrame, validateLandmarkFrame } from "./extractionModel.ts";
import type { ExtractionSample, LandmarkFrame } from "./extractionModel.ts";

export const DERIVED_ROOT = boundedPath(REPOSITORY_ROOT, "data/scope5/derived/mosl-v1/smoke5-v1/landmarks-v1");
export const EXTRACTION_ID = "mosl-smoke5-landmarks-v1";
export const TOOL_VERSION = "1";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

export async function readSafe(root: string, name: string): Promise<string> {
  const path = boundedPath(root, name);
  await assertNoLinks(REPOSITORY_ROOT, path);
  return decoder.decode(await readFile(path));
}

export interface ExtractionInputs {
  samples: ExtractionSample[];
  curationSHA256: Record<string, string>;
}
export async function loadExtractionInputs(): Promise<ExtractionInputs> {
  const texts: Record<string, string> = {};
  for (const name of CURATION_OUTPUT_NAMES) texts[name] = await readSafe(CURATION_ROOT, name);
  const coverage = JSON.parse(texts["coverage.json"]) as { artifactSHA256: Record<string, string> };
  for (const name of CURATION_OUTPUT_NAMES.filter(n => n !== "coverage.json")) assert.equal(sha256(texts[name]), coverage.artifactSHA256[name], `Frozen curation hash mismatch: ${name}`);
  return {
    samples: parseExtractionInputs(texts["vocabulary.json"], texts["samples.jsonl"], texts["coverage.json"]),
    curationSHA256: Object.fromEntries(CURATION_OUTPUT_NAMES.map(name => [name, sha256(texts[name])])),
  };
}

export async function verifyExtractionSources(inputs: ExtractionInputs): Promise<void> {
  for (const sample of inputs.samples) {
    const path = boundedPath(SOURCE_ROOT, sample.localVideoRelativePath);
    await assertNoLinks(REPOSITORY_ROOT, path);
    const actual = await hashFile(path);
    assertSourceHash(sample, actual);
  }
  for (const [name, digest] of Object.entries(inputs.curationSHA256)) assert.equal(sha256(await readSafe(CURATION_ROOT, name)), digest, `Curation changed: ${name}`);
}
export function assertSourceHash(sample: Pick<ExtractionSample, "sampleId" | "sha256" | "fileSizeBytes">, actual: { sha256: string; size: number }): void {
  assert.equal(actual.sha256, sample.sha256, `Source SHA-256 mismatch: ${sample.sampleId}`);
  assert.equal(actual.size, sample.fileSizeBytes, `Source byte-size mismatch: ${sample.sampleId}`);
}

/** Read the actual worker's scalar options for provenance; detector construction stays in Scope 4. */
export function readDetectorOptions(source: string): Record<string, string | number | boolean> {
  const file = ts.createSourceFile("landmarkTracking.worker.ts", source, ts.ScriptTarget.Latest, true);
  let options: Record<string, string | number | boolean> | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createFromOptions") {
      assert(!options, "Multiple detector configurations need explicit review");
      const literal = node.arguments[1];
      assert(literal && ts.isObjectLiteralExpression(literal), "Detector options are no longer a literal; review provenance extraction");
      options = {};
      for (const property of literal.properties) {
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === "canvas") continue;
        assert(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name), "Unexpected detector option structure");
        const name = property.name.text;
        if (name === "baseOptions") continue;
        const value = property.initializer;
        if (ts.isStringLiteral(value)) options[name] = value.text;
        else if (ts.isNumericLiteral(value)) options[name] = Number(value.text);
        else if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) options[name] = value.kind === ts.SyntaxKind.TrueKeyword;
        else throw new Error(`Detector option ${name} requires explicit provenance review`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert(options && options.runningMode === "VIDEO", "Expected existing VIDEO detector configuration");
  return options;
}

export async function verifyVisionRuntime() {
  const web = boundedPath(REPOSITORY_ROOT, "apps/web");
  const assets = JSON.parse(await readSafe(web, "vision-assets.json")) as { packageVersion: string; wasmPath: string; model: { path: string; sha256: string; bytes: number } };
  assert.equal(assets.packageVersion, "1.0.1");
  const pkgRoot = boundedPath(REPOSITORY_ROOT, "node_modules/@mediapipe/tasks-vision");
  const installed = JSON.parse(await readSafe(pkgRoot, "package.json")) as { version: string };
  assert.equal(installed.version, assets.packageVersion);
  const modelPath = boundedPath(web, `public/${assets.model.path}`);
  await assertNoLinks(REPOSITORY_ROOT, modelPath);
  const model = await hashFile(modelPath);
  assert.equal(model.sha256, assets.model.sha256, "Production Holistic model changed");
  assert.equal(model.size, assets.model.bytes);
  const wasm: Record<string, { sha256: string; size: number }> = {};
  for (const name of ["vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"]) {
    const local = boundedPath(web, `public/${assets.wasmPath}/${name}`);
    const installedFile = boundedPath(pkgRoot, `wasm/${name}`);
    await assertNoLinks(REPOSITORY_ROOT, local); await assertNoLinks(REPOSITORY_ROOT, installedFile);
    wasm[name] = await hashFile(local);
    assert.deepEqual(wasm[name], await hashFile(installedFile), "Prepared WASM differs from pinned installed runtime");
  }
  const tracking = "src/features/sign/tracking/";
  const reusedSources: Record<string, string> = {};
  for (const name of ["model.ts", "service.ts", "landmarkTracking.worker.ts", "workerClient.ts", "mediapipeHolisticAdapter.ts", "runtimeAssets.ts", "frameScheduler.ts"]) {
    reusedSources[`apps/web/${tracking}${name}`] = sha256(await readSafe(web, tracking + name));
  }
  const scheduler = await readSafe(web, tracking + "frameScheduler.ts");
  assert(scheduler.includes("Math.min(1, 960 / Math.max(source.width, source.height))") && scheduler.includes("resizeQuality: 'low'"), "Scope 4 size policy changed; review offline policy before extraction");
  return {
    mediapipeVersion: installed.version, model: { productionRelativePath: `apps/web/public/${assets.model.path}`, sha256: model.sha256, bytes: model.size },
    wasmRuntimeVersion: assets.packageVersion, wasm, reusedSources,
    detectorOptions: readDetectorOptions(await readSafe(web, tracking + "landmarkTracking.worker.ts")),
    maxImageLongEdge: 960, resizeQuality: "low", mirrored: false,
  };
}

export interface TrackingCoverage { frames: number; leftHand: number; rightHand: number; pose: number; face: number }
export const emptyCoverage = (): TrackingCoverage => ({ frames: 0, leftHand: 0, rightHand: 0, pose: 0, face: 0 });
export function countCoverage(coverage: TrackingCoverage, frame: LandmarkFrame): void {
  coverage.frames++;
  for (const key of ["leftHand", "rightHand", "pose", "face"] as const) if (frame[key] !== null) coverage[key]++;
}
export interface ExtractionResult {
  sampleId: string; classId: string; classIndex: number; rawSourceLabel: string;
  sourceCsv: string; sourceRow: number; declaredSignerId: string;
  sourceVideoRelativePath: string; sourceVideoSHA256: string; sourceDurationSeconds: number;
  status: "success" | "failed"; delegate: "GPU" | "CPU" | null;
  decodedSourceFrameCount: number; selectedSourceFrames: { index: number; timestampMs: number }[];
  sourceDimensions: { width: number; height: number }; sourceTimeBase: string;
  mediaStartMs: number; mediaEndMs: number;
  extractedLandmarkFrameCount: number; firstMediaTimestampMs: number | null; lastMediaTimestampMs: number | null;
  outputRelativePath: string | null; outputSHA256: string | null;
  coverage: TrackingCoverage; warnings: string[]; error: { stage: string; message: string } | null;
  inferenceMilliseconds: { total: number; maximum: number };
}
export async function verifySampleSequence(result: ExtractionResult): Promise<void> {
  assert.equal(result.status, "success");
  assert.equal(result.outputRelativePath, sampleOutputPath(result.sampleId));
  const path = boundedPath(DERIVED_ROOT, result.outputRelativePath!);
  await assertNoLinks(REPOSITORY_ROOT, path);
  const hash = await hashFile(path);
  assert.equal(hash.sha256, result.outputSHA256, "Landmark output SHA-256 mismatch");
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const coverage = emptyCoverage();
  let previous = -Infinity;
  try {
    for await (const line of lines) {
      const selected = result.selectedSourceFrames[coverage.frames];
      assert(selected, "Unexpected extra LandmarkFrame");
      const frame = validateLandmarkFrame(JSON.parse(line), {
        trackingRunId: `${EXTRACTION_ID}:${result.sampleId}`, sequence: coverage.frames + 1,
        timestampMs: selected.timestampMs, ...result.sourceDimensions,
      });
      assert.equal(serializeLandmarkFrame(frame), line + "\n", "Noncanonical LandmarkFrame JSONL");
      assert(frame.timestampMs > previous && frame.timestampMs >= result.mediaStartMs && frame.timestampMs <= result.mediaEndMs, "Landmark timestamp outside chronological media bounds");
      previous = frame.timestampMs;
      countCoverage(coverage, frame);
    }
  } finally { lines.close(); input.destroy(); }
  assert(coverage.frames > 0 && coverage.frames === result.selectedSourceFrames.length);
  assert.equal(coverage.frames, result.extractedLandmarkFrameCount);
  assert.equal(result.firstMediaTimestampMs, result.selectedSourceFrames[0].timestampMs);
  assert.equal(result.lastMediaTimestampMs, previous);
  assert.deepEqual(coverage, result.coverage);
}

/** Writes are fixed under derived output; no helper accepts a source destination. */
export async function writeDerived(name: string, text: string, replace = false): Promise<void> {
  const target = boundedPath(DERIVED_ROOT, name);
  const staging = boundedPath(DERIVED_ROOT, `${name}.pending`);
  await assertNoLinks(REPOSITORY_ROOT, target); await assertNoLinks(REPOSITORY_ROOT, staging);
  let owned = false;
  try {
    await writeFile(staging, text, { encoding: "utf8", flag: "wx" }); owned = true;
    if (replace) await rename(staging, target); else await link(staging, target);
  } finally {
    if (owned) await unlink(staging).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
export async function initializeDerivedDirectory(): Promise<void> {
  const directory = boundedPath(DERIVED_ROOT, "samples");
  await assertNoLinks(REPOSITORY_ROOT, directory);
  await mkdir(directory, { recursive: true });
}

export function buildExtractionManifest(input: {
  inputs: ExtractionInputs; vision: Awaited<ReturnType<typeof verifyVisionRuntime>>;
  browserVersion: string; runtimeInfo: Record<string, unknown>; mediaTools: Record<string, string>;
  extractionTimestamp: string; delegate: "GPU" | "CPU" | null; results: ExtractionResult[];
}) {
  const successful = input.results.filter(result => result.status === "success");
  assert(successful.every(result => result.delegate === input.delegate), "Mixed delegates cannot form an accepted artifact");
  assert.equal(new Set(input.results.map(r => r.sampleId)).size, input.results.length);
  for (const result of input.results) {
    const source = input.inputs.samples.find(s => s.sampleId === result.sampleId);
    assert(source, "Unexpected source in extraction result");
    for (const key of ["classId", "classIndex", "rawSourceLabel", "sourceCsv", "sourceRow", "declaredSignerId"] as const) assert.equal(result[key], source[key], `Extraction provenance differs: ${key}`);
    assert.equal(result.sourceVideoRelativePath, source.localVideoRelativePath, "Extraction source path differs");
    assert.equal(result.sourceVideoSHA256, source.sha256, "Extraction source hash differs");
    assert.equal(result.sourceDurationSeconds, source.duration, "Extraction source duration differs");
    assert.deepEqual(result.sourceDimensions, source.resolution, "Extraction source dimensions differ");
    assert(["success", "failed"].includes(result.status), "Unknown extraction status");
    for (const key of Object.keys(result.coverage) as (keyof TrackingCoverage)[]) assert(Number.isSafeInteger(result.coverage[key]) && result.coverage[key] >= 0 && result.coverage[key] <= result.coverage.frames, "Invalid tracking coverage count");
    assert.equal(result.coverage.frames, result.extractedLandmarkFrameCount, "Coverage/frame count differs");
    if (result.status === "success") {
      assert(result.coverage.frames > 0 && result.coverage.frames === result.selectedSourceFrames.length, "Incomplete successful frame count");
      assert.equal(result.outputRelativePath, sampleOutputPath(result.sampleId));
      assert(typeof result.outputSHA256 === "string" && /^[0-9a-f]{64}$/u.test(result.outputSHA256), "Missing output digest");
      assert.equal(result.error, null);
    } else assert(result.error && result.outputRelativePath === null && result.outputSHA256 === null, "Failed result cannot claim a completed output");
  }
  const coverage = emptyCoverage();
  for (const result of successful) for (const key of Object.keys(coverage) as (keyof TrackingCoverage)[]) coverage[key] += result.coverage[key];
  return {
    extractionDatasetId: EXTRACTION_ID, extractionSchemaVersion: 1, sourceCurationId: "mosl-smoke5-v1", sourceVocabularyId: "mosl-smoke5-v1",
    sourceSampleCount: input.inputs.samples.length, classCount: 5,
    landmarkFrame: { schemaVersion: 1, topology: "human-553-v1", anatomicalHands: true, mirrored: false },
    vision: input.vision, delegate: input.delegate,
    delegatePolicy: "First recording uses Scope 4 GPU-first with CPU initialization fallback; every subsequent recording is forced to the established delegate. No mixed accepted outputs.",
    targetExtractionFps: 15, frameSelection: { version: "presentation-greedy-v1", policy: "First decoded frame, then first frame with actual media timestamp >= last selected timestamp + 1000/15 ms. No duplicated frames or fixed-length resampling." },
    maxImageLongEdge: 960, browserVersion: input.browserVersion, browserRuntime: input.runtimeInfo,
    mediaTools: input.mediaTools, extractionToolVersion: TOOL_VERSION, extractionTimestamp: input.extractionTimestamp,
    curationSHA256: input.inputs.curationSHA256,
    totalSelectedSourceVideos: input.inputs.samples.length, successfulExtractions: successful.length,
    failedExtractions: input.results.filter(result => result.status === "failed").length,
    pendingExtractions: input.inputs.samples.length - input.results.length,
    totalLandmarkFrameCount: coverage.frames, trackingCoverage: coverage,
    purpose: "ENGINEERING_RAW_TRACKING_SEQUENCES_ONLY", linguisticReviewStatus: "unverified",
    status: successful.length === 21 ? "COMPLETE" : "INCOMPLETE",
    samples: input.results,
  };
}

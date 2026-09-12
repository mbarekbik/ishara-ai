import assert from "node:assert/strict";
import { open, link, unlink } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createExtractionBrowser } from "./extractionBrowser.ts";
import type { ExtractionBrowser } from "./extractionBrowser.ts";
import { decodeRecording, mediaToolVersions, probeRecording } from "./extractionDecoder.ts";
import { sampleOutputPath, serializeLandmarkFrame, validateLandmarkFrame } from "./extractionModel.ts";
import type { ExtractionSample } from "./extractionModel.ts";
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT, SOURCE_ROOT } from "./sourceFiles.ts";
import { buildExtractionManifest, countCoverage, DERIVED_ROOT, emptyCoverage, EXTRACTION_ID, initializeDerivedDirectory, json, loadExtractionInputs, readSafe, verifyExtractionSources, verifySampleSequence, verifyVisionRuntime, writeDerived } from "./extractionFiles.ts";
import type { ExtractionResult } from "./extractionFiles.ts";

type Manifest = ReturnType<typeof buildExtractionManifest>;
function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN_EXTRACTION_FAILURE";
  return error.message.replaceAll(REPOSITORY_ROOT, "<repository>").slice(0, 400);
}

function initialResult(sample: ExtractionSample): ExtractionResult {
  return {
    sampleId: sample.sampleId, classId: sample.classId, classIndex: sample.classIndex, rawSourceLabel: sample.rawSourceLabel,
    sourceCsv: sample.sourceCsv, sourceRow: sample.sourceRow, declaredSignerId: sample.declaredSignerId,
    sourceVideoRelativePath: sample.localVideoRelativePath, sourceVideoSHA256: sample.sha256, sourceDurationSeconds: sample.duration,
    status: "failed", delegate: null, decodedSourceFrameCount: 0, selectedSourceFrames: [], sourceDimensions: sample.resolution,
    sourceTimeBase: "", mediaStartMs: 0, mediaEndMs: sample.duration * 1000,
    extractedLandmarkFrameCount: 0, firstMediaTimestampMs: null, lastMediaTimestampMs: null,
    outputRelativePath: null, outputSHA256: null, coverage: emptyCoverage(), warnings: [], error: null,
    inferenceMilliseconds: { total: 0, maximum: 0 },
  };
}

async function extractSample(sample: ExtractionSample, browser: ExtractionBrowser, delegate: "GPU" | "CPU" | undefined, signal: AbortSignal): Promise<ExtractionResult> {
  const result = initialResult(sample);
  const source = boundedPath(SOURCE_ROOT, sample.localVideoRelativePath);
  const outputName = sampleOutputPath(sample.sampleId);
  const output = boundedPath(DERIVED_ROOT, outputName);
  const staging = boundedPath(DERIVED_ROOT, `${outputName}.pending`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let owned = false;
  let published = false;
  let stage = "probe";
  let inferenceError: unknown;
  try {
    if (signal.aborted) throw new Error("EXTRACTION_CANCELLED");
    const probe = await probeRecording(source, signal);
    assert.deepEqual({ width: probe.width, height: probe.height }, sample.resolution, "Decoded dimensions differ from curated source");
    assert.equal(probe.timestampsMs.length, sample.frameCount, "Decoded source-frame count differs from curated source");
    assert(Math.abs(probe.durationSeconds - sample.duration) < 0.00001, "Decoded duration differs from curated source");
    assert(probe.selectedIndices.length > 0, "No selected decoded frame");
    result.decodedSourceFrameCount = probe.timestampsMs.length;
    result.selectedSourceFrames = probe.selectedIndices.map(index => ({ index, timestampMs: probe.timestampsMs[index] }));
    result.sourceTimeBase = probe.timeBase; result.mediaStartMs = probe.startTimeMs; result.mediaEndMs = probe.endTimeMs;
    const runId = `${EXTRACTION_ID}:${sample.sampleId}`;
    stage = "detector-initialization";
    result.delegate = await browser.startSample(runId, delegate);
    assert(!delegate || result.delegate === delegate, "DELEGATE_MIXING_REJECTED");
    await assertNoLinks(REPOSITORY_ROOT, output); await assertNoLinks(REPOSITORY_ROOT, staging);
    handle = await open(staging, "wx"); owned = true;
    stage = "decoding";
    await decodeRecording(source, probe, async decoded => {
      stage = "inference";
      const started = performance.now();
      try {
        const frame = validateLandmarkFrame(await browser.infer(decoded.rgba, decoded.width, decoded.height, decoded.timestampMs, result.coverage.frames + 1, runId), {
          trackingRunId: runId, sequence: result.coverage.frames + 1, timestampMs: decoded.timestampMs, width: decoded.width, height: decoded.height,
        });
        const elapsed = performance.now() - started;
        result.inferenceMilliseconds.total += elapsed;
        result.inferenceMilliseconds.maximum = Math.max(result.inferenceMilliseconds.maximum, elapsed);
        assert(frame.timestampMs >= probe.startTimeMs && frame.timestampMs <= probe.endTimeMs, "Media timestamp out of source bounds");
        if (result.lastMediaTimestampMs !== null) assert(frame.timestampMs > result.lastMediaTimestampMs, "Nonmonotonic LandmarkFrame");
        stage = "serialization";
        await handle!.writeFile(serializeLandmarkFrame(frame), "utf8");
        countCoverage(result.coverage, frame);
        result.extractedLandmarkFrameCount++;
        result.firstMediaTimestampMs ??= frame.timestampMs; result.lastMediaTimestampMs = frame.timestampMs;
        stage = "decoding";
      } catch (error) { inferenceError = error; throw error; }
    }, signal);
    assert.equal(result.extractedLandmarkFrameCount, result.selectedSourceFrames.length, "Incomplete selected-frame extraction");
    stage = "detector-disposal";
    await browser.endSample();
    stage = "publication";
    await handle.sync(); await handle.close(); handle = undefined;
    // Exclusive publication preserves any prior complete sequence; no overwrite on retries.
    await link(staging, output); published = true;
    result.status = "success"; result.outputRelativePath = outputName;
    result.outputSHA256 = (await hashFile(output)).sha256;
    await verifySampleSequence(result);
    for (const component of ["leftHand", "rightHand", "pose", "face"] as const) {
      if (result.coverage[component] < result.coverage.frames) result.warnings.push(`${component}: absent in ${result.coverage.frames - result.coverage[component]} frames; retained for later preprocessing quality review`);
    }
    return result;
  } catch (error) {
    result.status = "failed"; result.error = { stage, message: safeMessage(inferenceError ?? error) };
    result.outputRelativePath = null; result.outputSHA256 = null;
    // A completed file that failed post-write verification is evidence, never silently overwritten.
    if (published) result.warnings.push("A published sequence failed validation; preserved for diagnosis and requires explicit review before retry");
    return result;
  } finally {
    await handle?.close();
    if (owned) await unlink(staging).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    await browser.endSample();
  }
}

async function verifyManifest(manifest: Manifest, inputs: Awaited<ReturnType<typeof loadExtractionInputs>>, vision: Awaited<ReturnType<typeof verifyVisionRuntime>>): Promise<void> {
  assert.equal(manifest.extractionDatasetId, EXTRACTION_ID);
  assert.equal(manifest.sourceSampleCount, 21); assert.equal(manifest.classCount, 5);
  assert.deepEqual(manifest.curationSHA256, inputs.curationSHA256, "Extraction belongs to different curation bytes");
  assert.deepEqual(manifest.vision, vision, "Pinned runtime/adapter changed after extraction");
  const rebuilt = buildExtractionManifest({ inputs, vision, browserVersion: manifest.browserVersion, runtimeInfo: manifest.browserRuntime, mediaTools: manifest.mediaTools, extractionTimestamp: manifest.extractionTimestamp, delegate: manifest.delegate, results: manifest.samples });
  assert.deepEqual(manifest, rebuilt, "Extraction manifest totals/provenance differ");
  for (const sample of manifest.samples.filter(result => result.status === "success")) await verifySampleSequence(sample);
  await verifyExtractionSources(inputs);
}

function extractionReadme(manifest: Manifest): string {
  return `# smoke5-v1 raw LandmarkFrame sequences\n\nDataset: ${EXTRACTION_ID}. Status: ${manifest.status}.\n\nINPUT: exactly 21 frozen mosl-smoke5-v1 engineering samples from data/scope5/curation/mosl-v1/smoke5-v1.\n\nPROCESS: MP4 → FFprobe presentation timestamps → streamed FFmpeg RGBA frames → greedy 15 FPS maximum timestamp selection → ImageBitmap → unchanged Scope 4 Holistic worker and provider-neutral adapter → LandmarkFrame JSONL. No live 500 ms expiry is applied. A fresh detector is disposed for each recording. The actual delegate is ${manifest.delegate ?? "unavailable"}, consistently forced after initial GPU-first/CPU fallback selection.\n\nOUTPUT: ${manifest.successfulExtractions} completed per-sample sequences; ${manifest.totalLandmarkFrameCount} frames; ${manifest.failedExtractions} failed samples. manifest.json records source provenance, timestamps, runtime/model/WASM/source-code hashes, detector options, output hashes and tracking coverage. extraction-report.json is also the resumable progress record; incomplete output is never accepted as a complete dataset.\n\n| Sample ID | Class | Frames | Left hand | Right hand | Pose | Face |\n|---|---|---:|---:|---:|---:|---:|\n${manifest.samples.map(s => `| ${s.sampleId} | ${s.classId} | ${s.extractedLandmarkFrameCount} | ${s.coverage.leftHand} | ${s.coverage.rightHand} | ${s.coverage.pose} | ${s.coverage.face} |`).join("\n")}\n\nTiming uses real presentation timestamps (integer PTS × stream time_base where available). The first frame is selected, then the next frame at least 1000/15 ms after the prior selected one. This can yield less than 15 FPS on discrete frame grids. No duplicated frames, smoothing, normalization, 64-timestep resampling, or feature masks are applied. Source dimensions remain original; the existing 960px maximum-long-edge ImageBitmap policy never upscales.\n\nCoordinates remain unmirrored and anatomical left/right semantics are unchanged. Optional/missing anatomy is preserved, with per-sample counts for later quality review. Missing anatomy alone does not exclude a recording. World coordinates and meaningful pose visibility follow the existing adapter.\n\nFilenames percent-encode the sample-ID colon because Windows cannot store it literally; decodeURIComponent(basename without .jsonl) recovers the exact original sampleId. IDs inside manifests remain unchanged. Sequence numbers start at 1 per recording. trackingRunId is ${EXTRACTION_ID}: followed by the source sampleId, and identifies processing continuity only. Canonical UTF-8/LF JSONL and timestamp selection are deterministic. Floating-point inference is tied to the recorded runtime/delegate and is not promised bit-identical across graphics drivers or browser versions.\n\nFrames pass through transient buffers only. No decoded images are written, videos copied to public assets, or private paths served by Vite. A dedicated loopback server exposes only an allowlist of static runtime assets. The unchanged worker's enforcing CSP restricts connections to the local origin. Browser profile/build scratch files are cleaned at close. No dataset/landmark upload or raw array logging is implemented. All outputs remain under Git-ignored data/scope5/.\n\nThese are RAW TRACKING SEQUENCES, not classifier features or training tensors. This engineering subset is linguistically unverified, has unverified declared signer identities, and is not a production vocabulary or signer-independent benchmark. No model was trained, no ONNX artifact was exported, and no Sign → Text recognition was implemented.\n\nNext phase, only after a new instruction: shared preprocessing and [64,170] tensor construction.\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--verify")) throw new Error("Only --verify is accepted; inputs and destination are fixed");
  const inputs = await loadExtractionInputs();
  await verifyExtractionSources(inputs);
  const vision = await verifyVisionRuntime();
  let previous: Manifest | null = null;
  try { previous = JSON.parse(await readSafe(DERIVED_ROOT, "manifest.json")) as Manifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (args[0] === "--verify" || previous?.status === "COMPLETE") {
    assert(previous, "No extraction manifest exists");
    await verifyManifest(previous, inputs, vision);
    assert.equal(previous.status, "COMPLETE", "Extraction has incomplete/failed samples");
    assert.deepEqual(JSON.parse(await readSafe(DERIVED_ROOT, "extraction-report.json")), previous, "Extraction report differs from manifest");
    assert.equal(await readSafe(DERIVED_ROOT, "README.md"), extractionReadme(previous), "Extraction README differs from manifest");
    console.log(json({ result: "VERIFIED", samples: previous.successfulExtractions, frames: previous.totalLandmarkFrameCount, delegate: previous.delegate, coverage: previous.trackingCoverage }));
    return;
  }
  // A resumed run may have newer completed samples than the last end-of-run manifest.
  try { previous = JSON.parse(await readSafe(DERIVED_ROOT, "extraction-report.json")) as Manifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous) await verifyManifest(previous, inputs, vision);
  await initializeDerivedDirectory();
  const mediaTools = await mediaToolVersions();
  if (previous) assert.deepEqual(mediaTools, previous.mediaTools, "Media tool version changed; review before resumption");
  let browser: ExtractionBrowser | undefined;
  const cancel = new AbortController();
  const interrupt = () => { cancel.abort(); void browser?.close(); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  let final: Manifest | undefined;
  let cleanupError: unknown;
  try {
    browser = await createExtractionBrowser();
    if (previous) {
      assert.equal(browser.browserVersion, previous.browserVersion, "Browser changed; review before resumption");
      assert.deepEqual(browser.runtimeInfo, previous.browserRuntime, "Graphics/runtime provenance changed; review before combining resumed results");
    }
    const timestamp = previous?.extractionTimestamp ?? new Date().toISOString();
    let delegate = previous?.delegate ?? undefined;
    const results = previous?.samples.filter(result => result.status === "success") ?? [];
    const build = () => buildExtractionManifest({ inputs, vision, browserVersion: browser!.browserVersion, runtimeInfo: browser!.runtimeInfo, mediaTools, extractionTimestamp: timestamp, delegate: delegate ?? null, results });
    for (const [index, sample] of inputs.samples.entries()) {
      if (cancel.signal.aborted) break;
      if (results.some(result => result.sampleId === sample.sampleId)) continue;
      console.log(`Extracting ${index + 1}/21 ${sample.classId} sourceRow=${sample.sourceRow}`);
      const result = await extractSample(sample, browser, delegate, cancel.signal);
      if (result.delegate) { assert(!delegate || delegate === result.delegate, "Mixed delegates rejected"); delegate = result.delegate; }
      results.push(result);
      results.sort((a, b) => inputs.samples.findIndex(s => s.sampleId === a.sampleId) - inputs.samples.findIndex(s => s.sampleId === b.sampleId));
      final = build();
      await writeDerived("extraction-report.json", json(final), true);
      console.log(`${result.status}: ${result.extractedLandmarkFrameCount} frames${result.error ? ` (${result.error.stage}: ${result.error.message})` : ""}`);
    }
    final = build();
  } finally {
    try { await browser?.close(); } catch (error) { cleanupError = error; }
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
  if (!final) throw new Error("Extraction could not initialize; no complete dataset produced");
  await verifyManifest(final, inputs, vision);
  await writeDerived("extraction-report.json", json(final), true);
  await writeDerived("README.md", extractionReadme(final), true);
  await writeDerived("manifest.json", json(final), true);
  if (cleanupError) throw new Error(`Extraction resource cleanup failed: ${safeMessage(cleanupError)}`);
  console.log(json({ result: final.status, samples: final.successfulExtractions, failures: final.samples.filter(s => s.status === "failed").map(s => ({ sampleId: s.sampleId, error: s.error })), frames: final.totalLandmarkFrameCount, delegate: final.delegate, coverage: final.trackingCoverage }));
  if (final.status !== "COMPLETE") process.exitCode = 1;
}

main().catch(error => { console.error(safeMessage(error)); process.exitCode = 1; });

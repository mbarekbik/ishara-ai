import { execFile, spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { selectFrameTimestamps } from "./extractionModel.ts";

const execute = promisify(execFile);
const MAX_PROBE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PIXELS = 4096 * 4096;
const MAX_FRAMES = 180_000;
const MAX_DURATION_SECONDS = 600;
const DECODE_TIMEOUT_MS = 300_000;

export interface RecordingProbe {
  width: number;
  height: number;
  durationSeconds: number;
  startTimeMs: number;
  endTimeMs: number;
  timestampsMs: number[];
  selectedIndices: number[];
  timeBase: string;
  codec: string;
}

export interface SelectedRgbaFrame {
  rgba: Buffer;
  timestampMs: number;
  sourceFrameIndex: number;
  width: number;
  height: number;
}

type DecoderCode = "INVALID_RECORDING_PATH" | "INVALID_RECORDING_PROBE" | "RECORDING_PROBE_FAILED" | "RECORDING_DECODE_FAILED" | "RECORDING_DECODE_TIMEOUT" | "RECORDING_FRAME_COUNT_MISMATCH" | "RECORDING_CALLBACK_FAILED" | "MEDIA_TOOLS_UNAVAILABLE";

/** Only stable application codes escape this boundary, never provider stderr or source paths. */
export class ExtractionDecoderError extends Error {
  readonly code: DecoderCode;
  constructor(code: DecoderCode) { super(code); this.name = "ExtractionDecoderError"; this.code = code; }
}

function requireValue(condition: unknown, code: DecoderCode = "INVALID_RECORDING_PROBE"): asserts condition {
  if (!condition) throw new ExtractionDecoderError(code);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  requireValue((typeof value === "string" && value.trim() !== "") || typeof value === "number");
  const parsed = Number(value);
  requireValue(Number.isFinite(parsed));
  return parsed;
}
function positiveInteger(value: unknown): number {
  const parsed = number(value);
  requireValue(Number.isSafeInteger(parsed) && parsed > 0);
  return parsed;
}
function validatePath(path: string): void {
  requireValue(typeof path === "string" && isAbsolute(path) && !path.includes("\0") && !/[\r\n]/u.test(path), "INVALID_RECORDING_PATH");
}

/** FFprobe frame timestamps remain the media clock; neither FPS nor array indices create timestamps. */
export function parseRecordingProbe(value: unknown): RecordingProbe {
  const root = object(value);
  requireValue(Array.isArray(root.streams) && root.streams.length === 1);
  requireValue(Array.isArray(root.frames) && root.frames.length > 0 && root.frames.length <= MAX_FRAMES);
  const stream = object(root.streams[0]);
  const width = positiveInteger(stream.width);
  const height = positiveInteger(stream.height);
  requireValue(width * height <= MAX_PIXELS);
  requireValue(typeof stream.time_base === "string" && /^[1-9]\d*\/[1-9]\d*$/u.test(stream.time_base));
  const [timeNumerator, timeDenominator] = stream.time_base.split("/").map(positiveInteger);
  requireValue(typeof stream.codec_name === "string" && /^[a-zA-Z0-9_]+$/u.test(stream.codec_name));
  const format = root.format === undefined ? {} : object(root.format);
  const durationSeconds = number(stream.duration ?? format.duration);
  requireValue(durationSeconds > 0 && durationSeconds <= MAX_DURATION_SECONDS);
  const timestampsMs = root.frames.map(raw => {
    const frame = object(raw);
    requireValue(positiveInteger(frame.width) === width && positiveInteger(frame.height) === height);
    const pts = frame.pts === undefined || frame.pts === "N/A" ? frame.best_effort_timestamp : frame.pts;
    if (pts !== undefined && pts !== "N/A") {
      const ticks = number(pts);
      requireValue(Number.isSafeInteger(ticks));
      return ticks * timeNumerator / timeDenominator * 1000;
    }
    const timestamp = frame.pts_time === undefined || frame.pts_time === "N/A" ? frame.best_effort_timestamp_time : frame.pts_time;
    return number(timestamp) * 1000;
  });
  const startTimeMs = number(stream.start_time ?? format.start_time ?? timestampsMs[0] / 1000) * 1000;
  const endTimeMs = startTimeMs + durationSeconds * 1000;
  requireValue(startTimeMs >= 0 && Number.isFinite(endTimeMs));
  requireValue(timestampsMs.every(time => time >= startTimeMs - 0.01 && time < endTimeMs + 0.01));
  let selectedIndices: number[];
  try { selectedIndices = selectFrameTimestamps(timestampsMs); }
  catch { throw new ExtractionDecoderError("INVALID_RECORDING_PROBE"); }
  return { width, height, durationSeconds, startTimeMs, endTimeMs, timestampsMs, selectedIndices, timeBase: stream.time_base, codec: stream.codec_name };
}

export async function probeRecording(absolutePath: string, signal?: AbortSignal): Promise<RecordingProbe> {
  validatePath(absolutePath);
  checkAbort(signal);
  try {
    const { stdout, stderr } = await execute("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries",
      "stream=width,height,duration,start_time,time_base,codec_name:frame=pts,best_effort_timestamp,pts_time,best_effort_timestamp_time,width,height:format=duration,start_time",
      "-of", "json", absolutePath,
    ], { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: MAX_PROBE_BYTES, signal });
    requireValue(stderr.trim().length === 0, "RECORDING_PROBE_FAILED");
    return parseRecordingProbe(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof ExtractionDecoderError) throw error;
    throw new ExtractionDecoderError("RECORDING_PROBE_FAILED");
  }
}

function validateDecoderProbe(probe: RecordingProbe): void {
  requireValue(Number.isSafeInteger(probe.width) && probe.width > 0 && Number.isSafeInteger(probe.height) && probe.height > 0 && probe.width * probe.height <= MAX_PIXELS);
  requireValue(probe.timestampsMs.length > 0 && probe.timestampsMs.length <= MAX_FRAMES);
  let selected: number[];
  try { selected = selectFrameTimestamps(probe.timestampsMs); }
  catch { throw new ExtractionDecoderError("INVALID_RECORDING_PROBE"); }
  requireValue(selected.length === probe.selectedIndices.length && selected.every((index, position) => index === probe.selectedIndices[position]));
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof ExtractionDecoderError ? signal.reason : new ExtractionDecoderError("RECORDING_DECODE_FAILED");
}

async function waitForCallback(operation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return operation;
  checkAbort(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason instanceof ExtractionDecoderError ? signal.reason : new ExtractionDecoderError("RECORDING_DECODE_FAILED"));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort)).catch(() => undefined);
  });
}

/** One owned selected-frame buffer; stream backpressure waits for its consumer before reading further. */
export async function streamSelectedRgbaFrames(
  chunks: AsyncIterable<Uint8Array>, probe: RecordingProbe,
  onSelected: (frame: SelectedRgbaFrame) => Promise<void>, signal?: AbortSignal,
): Promise<void> {
  validateDecoderProbe(probe);
  const frameBytes = probe.width * probe.height * 4;
  let sourceFrameIndex = 0;
  let position = 0;
  let selectedPosition = 0;
  let rgba: Buffer | null = null;
  for await (const chunk of chunks) {
    checkAbort(signal);
    let offset = 0;
    while (offset < chunk.byteLength) {
      checkAbort(signal);
      requireValue(sourceFrameIndex < probe.timestampsMs.length, "RECORDING_FRAME_COUNT_MISMATCH");
      const selected = probe.selectedIndices[selectedPosition] === sourceFrameIndex;
      if (selected && rgba === null) rgba = Buffer.allocUnsafe(frameBytes);
      const copied = Math.min(frameBytes - position, chunk.byteLength - offset);
      if (selected) rgba!.set(chunk.subarray(offset, offset + copied), position);
      position += copied;
      offset += copied;
      if (position === frameBytes) {
        if (selected) {
          const frame = { rgba: rgba!, timestampMs: probe.timestampsMs[sourceFrameIndex], sourceFrameIndex, width: probe.width, height: probe.height };
          try { await waitForCallback(Promise.resolve().then(() => onSelected(frame)), signal); }
          catch (error) {
            if (error instanceof ExtractionDecoderError) throw error;
            throw new ExtractionDecoderError("RECORDING_CALLBACK_FAILED");
          }
          checkAbort(signal);
          rgba = null;
          selectedPosition += 1;
        }
        sourceFrameIndex += 1;
        position = 0;
      }
    }
  }
  checkAbort(signal);
  requireValue(position === 0 && sourceFrameIndex === probe.timestampsMs.length && selectedPosition === probe.selectedIndices.length, "RECORDING_FRAME_COUNT_MISMATCH");
}

export async function decodeRecording(absolutePath: string, probe: RecordingProbe, onSelected: (frame: SelectedRgbaFrame) => Promise<void>, signal?: AbortSignal): Promise<void> {
  validatePath(absolutePath);
  validateDecoderProbe(probe);
  checkAbort(signal);
  const child = spawn("ffmpeg", [
    "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-noautorotate", "-threads", "1", "-i", absolutePath,
    "-map", "0:v:0", "-an", "-sn", "-dn", "-threads", "1", "-filter_threads", "1",
    "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const cancellation = new AbortController();
  const externalAbort = (): void => cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_FAILED"));
  signal?.addEventListener("abort", externalAbort, { once: true });
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let stderrBytes = 0;
  let failed = false;
  let closed = false;
  const stop = (): void => {
    child.stdout.destroy();
    child.stderr.destroy();
    if (!closed) {
      child.kill("SIGTERM");
      forceKill ??= setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 250);
    }
  };
  cancellation.signal.addEventListener("abort", stop, { once: true });
  child.stderr.on("data", (chunk: Buffer) => {
    // Count and discard; retaining FFmpeg diagnostics could retain private absolute paths.
    stderrBytes += chunk.byteLength;
    if (stderrBytes > MAX_STDERR_BYTES) cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_FAILED"));
  });
  child.on("error", () => { failed = true; cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_FAILED")); });
  const completion = new Promise<void>(resolve => child.once("close", code => {
    closed = true;
    if (code !== 0) failed = true;
    if (failed || stderrBytes > 0) cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_FAILED"));
    resolve();
  }));
  const deadline = setTimeout(() => cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_TIMEOUT")), DECODE_TIMEOUT_MS);
  try {
    await streamSelectedRgbaFrames(child.stdout, probe, onSelected, cancellation.signal);
    await waitForCallback(completion, cancellation.signal);
    checkAbort(cancellation.signal);
  } catch (error) {
    cancellation.abort(error instanceof ExtractionDecoderError ? error : new ExtractionDecoderError("RECORDING_DECODE_FAILED"));
    throw cancellation.signal.reason;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", externalAbort);
    cancellation.signal.removeEventListener("abort", stop);
    stop();
    // A stuck child never prevents this boundary from returning. Windows kill terminates directly.
    let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([completion, new Promise<void>(resolve => { cleanupDeadline = setTimeout(resolve, 1000); })]);
    if (cleanupDeadline) clearTimeout(cleanupDeadline);
    if (forceKill) clearTimeout(forceKill);
    if (!closed) { child.kill("SIGKILL"); child.unref(); }
  }
}

export async function mediaToolVersions(): Promise<{ ffmpeg: string; ffprobe: string }> {
  try {
    const results = await Promise.all(["ffmpeg", "ffprobe"].map(async executable => {
      const { stdout } = await execute(executable, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
      const version = stdout.split(/\r?\n/u)[0];
      requireValue(version.startsWith(`${executable} version `) && version.length < 1024, "MEDIA_TOOLS_UNAVAILABLE");
      return version;
    }));
    return { ffmpeg: results[0], ffprobe: results[1] };
  } catch { throw new ExtractionDecoderError("MEDIA_TOOLS_UNAVAILABLE"); }
}

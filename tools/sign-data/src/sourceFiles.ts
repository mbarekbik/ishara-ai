import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { VideoRecord } from "./contracts.ts";

const execute = promisify(execFile);
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SOURCE_ROOT = resolve(REPOSITORY_ROOT, "data/scope5/source/mosl-v1");
export const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, "data/scope5/audit/mosl-v1");
export const EXPECTED = Object.freeze({
  videos: 2216,
  csvs: 5,
  videoBytes: 222795265,
  videoDigest: "4d813a0698f5714cc5ea13c434294259cf42cd6379d28a24009da642b6a3d891",
  datasetDigest: "1577cd440e604ca24ce4b360ff453736f38a65701ac0171eb2150c9b509f9c8b",
});
export interface SourceFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  sha256: string;
}
export const ordinal = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export function boundedPath(root: string, child: string): string {
  const result = resolve(root, child);
  const tail = relative(root, result);
  if (!tail || tail === ".." || tail.startsWith(`..${sep}`) || isAbsolute(tail)) {
    throw new Error("Path must name a child inside its designated root");
  }
  return result;
}

export async function assertNoLinks(root: string, target: string): Promise<void> {
  const tail = relative(root, target);
  if (tail) boundedPath(root, tail);
  for (const part of [root, ...tail.split(sep).filter(Boolean).map((_, i, parts) => resolve(root, ...parts.slice(0, i + 1)))]) {
    try {
      if ((await lstat(part)).isSymbolicLink()) throw new Error(`Symbolic links/junctions are not permitted: ${part}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function hashFile(path: string): Promise<{ size: number; sha256: string }> {
  const before = await stat(path);
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    digest.update(buffer);
  }
  const after = await stat(path);
  if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("Source changed during checksum verification; no output may be published");
  }
  return { size: bytes, sha256: digest.digest("hex") };
}

export async function collectSourceFiles(): Promise<SourceFile[]> {
  await assertNoLinks(REPOSITORY_ROOT, SOURCE_ROOT);
  if ((await realpath(SOURCE_ROOT)).toLowerCase() !== SOURCE_ROOT.toLowerCase()) throw new Error("Source root resolves elsewhere");
  const paths: string[] = [];
  async function visit(directory: string, extension: string): Promise<void> {
    await assertNoLinks(SOURCE_ROOT, directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = boundedPath(SOURCE_ROOT, relative(SOURCE_ROOT, resolve(directory, entry.name)));
      if (entry.isSymbolicLink()) throw new Error("Source contains a symbolic link/junction");
      if (entry.isDirectory()) await visit(path, extension);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) paths.push(path);
    }
  }
  await visit(boundedPath(SOURCE_ROOT, "videos"), ".mp4");
  await visit(boundedPath(SOURCE_ROOT, "metadata"), ".csv");
  const results: SourceFile[] = [];
  for (const absolutePath of paths.sort(ordinal)) {
    const tail = relative(SOURCE_ROOT, absolutePath).split(sep).join("/");
    if (/[\r\n\\]/u.test(tail)) throw new Error("Source path cannot be represented in the documented checksum format");
    results.push({ relativePath: tail, absolutePath, ...await hashFile(absolutePath) });
  }
  return results.sort((a, b) => ordinal(a.relativePath, b.relativePath));
}

export function inventoryDigest(files: readonly SourceFile[]): string {
  const ordered = [...files].sort((a, b) => ordinal(a.relativePath, b.relativePath));
  return sha256(ordered.map(f => `${f.relativePath}\0${f.size}\0${f.sha256}\n`).join(""));
}

export function verifyBaseline(files: readonly SourceFile[]): void {
  const videos = files.filter(f => f.relativePath.startsWith("videos/"));
  const metadata = files.filter(f => f.relativePath.startsWith("metadata/"));
  if (videos.length !== EXPECTED.videos || metadata.length !== EXPECTED.csvs || videos.reduce((n, f) => n + f.size, 0) !== EXPECTED.videoBytes || inventoryDigest(videos) !== EXPECTED.videoDigest || inventoryDigest(files) !== EXPECTED.datasetDigest) {
    throw new Error("STOP: source inventory differs from the previously verified counts or SHA-256 digests. Investigate; known results were not replaced.");
  }
}

function numeric(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function rational(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split("/").map(Number);
  const result = parts.length === 2 ? parts[0] / parts[1] : Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

export async function probeVideo(file: SourceFile): Promise<VideoRecord["media"]> {
  async function probe(count: boolean): Promise<{ stream: Record<string, unknown>; format: Record<string, unknown> }> {
    const args = ["-v", "error", ...(count ? ["-count_frames"] : []), "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate,duration,nb_frames,nb_read_frames:format=format_name,duration,size", "-of", "json", file.absolutePath];
    const { stdout, stderr } = await execute("ffprobe", args, { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024 });
    if (stderr.trim()) throw new Error(`ffprobe reported an error for ${file.relativePath}`);
    const data = JSON.parse(stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
    if (!data.streams?.[0] || !data.format) throw new Error(`Missing video stream/container: ${file.relativePath}`);
    return { stream: data.streams[0], format: data.format };
  }
  let { stream, format } = await probe(false);
  let frameCount = numeric(stream.nb_frames);
  let frameCountSource: "container-header" | "counted-decode" = "container-header";
  if (frameCount === null) {
    ({ stream, format } = await probe(true));
    frameCount = numeric(stream.nb_read_frames);
    frameCountSource = "counted-decode";
  }
  const media: VideoRecord["media"] = {
    readable: true,
    duration: numeric(stream.duration) ?? numeric(format.duration),
    frameRate: rational(stream.avg_frame_rate),
    frameRateRational: typeof stream.avg_frame_rate === "string" ? stream.avg_frame_rate : null,
    frameCount,
    width: numeric(stream.width),
    height: numeric(stream.height),
    codec: String(stream.codec_name),
    container: String(format.format_name),
    frameCountSource,
  };
  if ([media.duration, media.frameRate, media.frameCount, media.width, media.height].some(n => n === null || n <= 0) || numeric(format.size) !== file.size) {
    throw new Error(`Invalid or inconsistent media properties: ${file.relativePath}`);
  }
  return media;
}

export async function toolVersions(): Promise<Record<string, string>> {
  const { stdout } = await execute("ffprobe", ["-version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return { node: process.version, ffprobe: stdout.split(/\r?\n/u)[0], exporter: "1" };
}

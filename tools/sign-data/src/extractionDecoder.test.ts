import assert from "node:assert/strict";
import test from "node:test";
import { ExtractionDecoderError, parseRecordingProbe, streamSelectedRgbaFrames } from "./extractionDecoder.ts";
import type { RecordingProbe, SelectedRgbaFrame } from "./extractionDecoder.ts";

function probeJson(times = [0, 0.04, 0.08, 0.12, 0.2]): {
  streams: { width: number; height: number; start_time: string; duration: string; time_base: string; codec_name: string }[];
  frames: Record<string, unknown>[];
} {
  return {
    streams: [{ width: 1, height: 1, start_time: "0", duration: "0.24", time_base: "1/1000", codec_name: "h264" }],
    frames: times.map(time => ({ width: 1, height: 1, pts_time: time.toString() })),
  };
}
function probe(): RecordingProbe { return parseRecordingProbe(probeJson()); }
async function* chunks(...buffers: Uint8Array[]): AsyncGenerator<Uint8Array> { yield* buffers; }

test("probe preserves variable presentation timestamps and greedily selects actual media frames", () => {
  const value = probe();
  assert.deepEqual(value.timestampsMs, [0, 40, 80, 120, 200]);
  assert.deepEqual(value.selectedIndices, [0, 2, 4]);
  assert.equal(value.durationSeconds, 0.24);
  assert.equal(value.startTimeMs, 0);
  assert.equal(value.endTimeMs, 240);
});

test("integer PTS plus time base takes precedence over rounded textual timestamps", () => {
  const input = probeJson();
  input.streams[0].time_base = "1/30000";
  input.frames = [0, 1000, 2000, 3000, 4000].map(pts => ({ width: 1, height: 1, pts, pts_time: (pts / 30000).toFixed(6) }));
  const value = parseRecordingProbe(input);
  assert.equal(value.timestampsMs[2], 2000 / 30000 * 1000);
  assert.notEqual(value.timestampsMs[2], 66.667);
  assert.deepEqual(value.selectedIndices, [0, 2, 4]);
});

test("actual best-effort timestamp is accepted only when PTS is unavailable", () => {
  const input = probeJson();
  input.frames = [0, 40, 80].map(ticks => ({ width: 1, height: 1, pts: "N/A", best_effort_timestamp: ticks }));
  assert.deepEqual(parseRecordingProbe(input).timestampsMs, [0, 40, 80]);
  input.frames = [0, 0.04, 0.08].map(time => ({ width: 1, height: 1, best_effort_timestamp_time: String(time) }));
  assert.deepEqual(parseRecordingProbe(input).timestampsMs, [0, 40, 80]);
});

test("nonzero media start is preserved rather than reconstructed from frame indices", () => {
  const input = probeJson([3, 3.04, 3.08]);
  input.streams[0].start_time = "3";
  const value = parseRecordingProbe(input);
  assert.equal(value.startTimeMs, 3000);
  assert.equal(value.endTimeMs, 3240);
  assert.deepEqual(value.timestampsMs, [3000, 3040, 3080]);
});

for (const [name, times] of Object.entries({ duplicate: [0, 0], descending: [0.08, 0.04], negative: [-0.01, 0.04], nonfinite: [0, Infinity], outsideDuration: [0, 0.5] })) {
  test(`probe rejects ${name} timestamps without creating a replacement clock`, () => {
    assert.throws(() => parseRecordingProbe(probeJson(times)), { message: "INVALID_RECORDING_PROBE" });
  });
}

test("probe rejects geometry changes, missing timestamps and unsafe bounds", () => {
  const changed = probeJson();
  changed.frames[1].width = 2;
  assert.throws(() => parseRecordingProbe(changed), ExtractionDecoderError);
  const missing = probeJson();
  delete missing.frames[0].pts_time;
  assert.throws(() => parseRecordingProbe(missing), ExtractionDecoderError);
  const oversize = probeJson();
  oversize.streams[0].width = 8192;
  oversize.streams[0].height = 8192;
  assert.throws(() => parseRecordingProbe(oversize), ExtractionDecoderError);
  const badTimeBase = probeJson();
  badTimeBase.streams[0].time_base = "1/0";
  assert.throws(() => parseRecordingProbe(badTimeBase), ExtractionDecoderError);
});

test("RGBA stream assembles split chunks, skips unselected frames and retains source PTS", async () => {
  const input = Buffer.from(Array.from({ length: 20 }, (_, index) => index));
  const received: SelectedRgbaFrame[] = [];
  await streamSelectedRgbaFrames(chunks(input.subarray(0, 1), input.subarray(1, 8), input.subarray(8, 11), input.subarray(11)), probe(), async frame => { received.push(frame); });
  assert.deepEqual(received.map(frame => frame.sourceFrameIndex), [0, 2, 4]);
  assert.deepEqual(received.map(frame => frame.timestampMs), [0, 80, 200]);
  assert.deepEqual(received.map(frame => [...frame.rgba]), [[0, 1, 2, 3], [8, 9, 10, 11], [16, 17, 18, 19]]);
  assert.deepEqual([...input], Array.from({ length: 20 }, (_, index) => index));
  assert(received.every(frame => frame.width === 1 && frame.height === 1));
});

test("backpressure waits for selected frame completion before consuming the next chunk", async () => {
  let chunksRead = 0;
  let callbacks = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered: (() => void) | undefined;
  const first = new Promise<void>(resolve => { entered = resolve; });
  async function* source(): AsyncGenerator<Buffer> {
    for (let index = 0; index < 5; index++) { chunksRead += 1; yield Buffer.alloc(4, index); }
  }
  const pending = streamSelectedRgbaFrames(source(), probe(), async () => {
    callbacks += 1;
    if (callbacks === 1) { entered!(); await gate; }
  });
  await first;
  assert.equal(chunksRead, 1);
  assert.equal(callbacks, 1);
  release!();
  await pending;
  assert.equal(chunksRead, 5);
  assert.equal(callbacks, 3);
});

for (const length of [0, 16, 19, 21, 24]) {
  test(`decoded byte length ${length} cannot silently disagree with probed frame count`, async () => {
    await assert.rejects(streamSelectedRgbaFrames(chunks(Buffer.alloc(length)), probe(), async () => undefined), { message: "RECORDING_FRAME_COUNT_MISMATCH" });
  });
}

test("callback failures escape only as a stable sanitized code and close the stream", async () => {
  let disposed = false;
  async function* source(): AsyncGenerator<Buffer> {
    try { yield Buffer.alloc(20); }
    finally { disposed = true; }
  }
  await assert.rejects(streamSelectedRgbaFrames(source(), probe(), async () => { throw new Error("private/source/path.mp4"); }), { message: "RECORDING_CALLBACK_FAILED" });
  assert.equal(disposed, true);
});

test("cancellation settles a never-completing callback and closes its source iterator", async () => {
  let disposed = false;
  const cancellation = new AbortController();
  async function* source(): AsyncGenerator<Buffer> {
    try { yield Buffer.alloc(20); }
    finally { disposed = true; }
  }
  const pending = streamSelectedRgbaFrames(source(), probe(), async () => {
    queueMicrotask(() => cancellation.abort(new ExtractionDecoderError("RECORDING_DECODE_TIMEOUT")));
    await new Promise<void>(() => undefined);
  }, cancellation.signal);
  await assert.rejects(pending, { message: "RECORDING_DECODE_TIMEOUT" });
  assert.equal(disposed, true);
});

test("malformed frame selection is rejected before consuming decoded data", async () => {
  const value = probe();
  value.selectedIndices = [0, 0, 4];
  let read = false;
  async function* source(): AsyncGenerator<Buffer> { read = true; yield Buffer.alloc(20); }
  await assert.rejects(streamSelectedRgbaFrames(source(), value, async () => undefined), { message: "INVALID_RECORDING_PROBE" });
  assert.equal(read, false);
});

import { beforeEach, expect, test, vi } from "vitest";
import { createMicrophoneCapture } from "./microphoneCapture";
class Track extends EventTarget {
  readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
}
class Context extends EventTarget {
  static current: Context;
  state = "suspended";
  sampleRate = 16000;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { super(); Context.current = this; }
}
class Processor {
  static current: Processor;
  onprocessorerror: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn();
  port = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn(), postMessage: vi.fn((command: string) => {
    if (command === "flush") queueMicrotask(() => this.port.onmessage?.(new MessageEvent("message", {data:{type:"flushed"}})));
  }) };
  constructor() { Processor.current = this; }
}
function stream(track: Track) { return {getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream; }
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true); vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Processor);
});
test("cancelled permission requests release late streams and the context", async () => {
  let resolve!: (value: MediaStream) => void;
  const request=vi.fn(()=>new Promise<MediaStream>(done=>{resolve=done;}));
  vi.stubGlobal("navigator", {mediaDevices:{getUserMedia:request}});
  const controller=new AbortController();
  const pending=createMicrophoneCapture({signal:controller.signal,onAudio:vi.fn(),onError:vi.fn()});
  controller.abort(); await expect(pending).rejects.toMatchObject({name:"AbortError"});
  const track=new Track(); resolve(stream(track)); await Promise.resolve();
  expect(track.stop).toHaveBeenCalledTimes(1); expect(Context.current.close).toHaveBeenCalledTimes(1);
});
test("stop releases tracks immediately, flushes, then closes nodes and context once", async () => {
  const track=new Track(); const request=vi.fn(async()=>stream(track));
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:request}});
  const capture=await createMicrophoneCapture({signal:new AbortController().signal,onAudio:vi.fn(),onError:vi.fn()});
  capture.start(); const stopped=capture.stop(); expect(track.stop).toHaveBeenCalledTimes(1);
  expect(capture.stop()).toBe(stopped); await stopped; capture.cancel();
  expect(Context.current.close).toHaveBeenCalledTimes(1); expect(Processor.current.disconnect).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({video:false}));
});
test("permission denial and ended devices are recoverable resource failures", async () => {
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:vi.fn(async()=>{throw new DOMException("", "NotAllowedError");})}});
  await expect(createMicrophoneCapture({signal:new AbortController().signal,onAudio:vi.fn(),onError:vi.fn()})).rejects.toThrow("MIC_DENIED");
  expect(Context.current.close).toHaveBeenCalledTimes(1);
  const track=new Track();vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:vi.fn(async()=>stream(track))}});
  const error=vi.fn();await createMicrophoneCapture({signal:new AbortController().signal,onAudio:vi.fn(),onError:error});
  track.dispatchEvent(new Event("ended"));expect(error).toHaveBeenCalledWith("MIC_ENDED");expect(track.stop).toHaveBeenCalledTimes(1);
});

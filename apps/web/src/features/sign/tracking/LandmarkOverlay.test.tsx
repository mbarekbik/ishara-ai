import { createRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandmarkOverlay } from "./LandmarkOverlay";
import type { LandmarkFrame } from "./model";

function setup() {
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 400, height: 400, top: 0, left: 0, right: 400, bottom: 400, toJSON: () => ({}) });
  let frameId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancel = vi.fn((id: number) => { callbacks.delete(id); });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("devicePixelRatio", 1);
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    disconnect = disconnect;
  });
  const video = document.createElement("video");
  Object.defineProperties(video, { videoWidth: { value: 1280, configurable: true }, videoHeight: { value: 720, configurable: true } });
  video.currentTime = 1.2;
  const frameRef = createRef<LandmarkFrame | null>();
  frameRef.current = { schemaVersion: 1, topology: "human-553-v1", trackingRunId: "run", sequence: 1, timestampMs: 1000, source: { width: 1280, height: 720, mirrored: false }, pose: null, leftHand: null, rightHand: null, face: null };
  const tick = () => {
    const entry = callbacks.entries().next().value;
    if (!entry) throw new Error("No animation frame scheduled");
    callbacks.delete(entry[0]);
    entry[1](0);
  };
  return { context, video, frameRef, tick, callbacks, cancel, disconnect };
}

describe("LandmarkOverlay ownership", () => {
  it("reads ref updates without rerenders and clears a stale or null frame", () => {
    const state = setup();
    render(<LandmarkOverlay video={state.video} frameRef={state.frameRef} />);
    state.tick();
    expect(state.context.clearRect).toHaveBeenCalledTimes(1);
    state.tick();
    expect(state.context.clearRect).toHaveBeenCalledTimes(1);
    state.frameRef.current = { ...state.frameRef.current!, sequence: 2, timestampMs: 1100 };
    state.tick();
    expect(state.context.clearRect).toHaveBeenCalledTimes(2);
    state.video.currentTime = 2;
    state.tick();
    expect(state.context.clearRect).toHaveBeenCalledTimes(3);
    expect(state.context.clip).toHaveBeenCalledTimes(2);
    state.frameRef.current = null;
    state.tick();
    expect(state.context.clip).toHaveBeenCalledTimes(2);
  });
  it("updates the backing resolution on DPR changes and releases observers/RAF", () => {
    const state = setup();
    const view = render(<LandmarkOverlay video={state.video} frameRef={state.frameRef} />);
    const canvas = view.container.querySelector("canvas")!;
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveStyle({ pointerEvents: "none" });
    state.tick();
    expect(canvas.width).toBe(400);
    vi.stubGlobal("devicePixelRatio", 2);
    state.tick();
    expect(canvas.width).toBe(800);
    expect(state.context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    view.unmount();
    expect(state.disconnect).toHaveBeenCalledOnce();
    expect(state.callbacks.size).toBe(0);
    expect(state.context.clearRect).toHaveBeenLastCalledWith(0, 0, 800, 800);
  });
  it("clears immediately when the video node is removed", () => {
    const state = setup();
    const view = render(<LandmarkOverlay video={state.video} frameRef={state.frameRef} />);
    state.tick();
    view.rerender(<LandmarkOverlay video={null} frameRef={state.frameRef} />);
    expect(state.callbacks.size).toBe(0);
    expect(state.context.clearRect).toHaveBeenCalledTimes(2);
  });
});

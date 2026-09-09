import { describe, expect, it, vi } from "vitest";
import { isOverlayFrameCurrent, renderLandmarkFrame } from "./landmarkRenderer";
import type { ImageLandmark, LandmarkFrame } from "./model";
import { FACE_CONTOURS, HAND_CONNECTIONS, POSE_CONNECTIONS } from "./topology";

function frame(): LandmarkFrame {
  return { schemaVersion: 1, topology: "human-553-v1", trackingRunId: "run", sequence: 1, timestampMs: 1000, source: { width: 1280, height: 720, mirrored: false }, pose: null, leftHand: null, rightHand: null, face: null };
}
function points(count: number, visibility?: number): ImageLandmark[] {
  return Array.from({ length: count }, () => ({ x: 0.25, y: 0.5, z: 0, ...(visibility === undefined ? {} : { visibility }) }));
}
function context() {
  return { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
}
function draw(ctx: ReturnType<typeof context>, value: LandmarkFrame | null) {
  renderLandmarkFrame(ctx as unknown as CanvasRenderingContext2D, value, 400, 400, 2);
}

describe("landmark rendering", () => {
  it("clears old geometry when the frame is empty", () => {
    const ctx = context();
    draw(ctx, null);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 400, 400);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });
  it("clips to the contained source rectangle and mirrors hand coordinates once", () => {
    const ctx = context();
    draw(ctx, { ...frame(), leftHand: { image: points(21, 0) } });
    expect(ctx.rect).toHaveBeenCalledWith(0, 87.5, 400, 225);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.moveTo).toHaveBeenCalledTimes(HAND_CONNECTIONS.length);
    expect(ctx.moveTo).toHaveBeenCalledWith(300, 200);
    expect(ctx.arc).toHaveBeenCalledTimes(21);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
  it("suppresses low-visibility pose connections and points without suppressing hands", () => {
    const ctx = context();
    draw(ctx, { ...frame(), pose: { image: points(33, 0.49) }, rightHand: { image: points(21, 0) } });
    expect(ctx.moveTo).toHaveBeenCalledTimes(HAND_CONNECTIONS.length);
    expect(ctx.arc).toHaveBeenCalledTimes(21);
  });
  it("renders visible pose and restrained face contours, preserving the source arrays", () => {
    const ctx = context();
    const source = { ...frame(), pose: { image: points(33, 0.5) }, face: { image: points(478, 0) } };
    draw(ctx, source);
    expect(ctx.moveTo).toHaveBeenCalledTimes(POSE_CONNECTIONS.length + FACE_CONTOURS.length);
    expect(ctx.arc).toHaveBeenCalledTimes(33);
    expect(source.face.image).toHaveLength(478);
    expect(FACE_CONTOURS.length).toBeLessThan(478);
  });
  it("contains all connection indices within the versioned topology", () => {
    for (const [connections, count] of [[HAND_CONNECTIONS, 21], [POSE_CONNECTIONS, 33], [FACE_CONTOURS, 478]] as const) {
      for (const [start, end] of connections) {
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThanOrEqual(0);
        expect(start).toBeLessThan(count);
        expect(end).toBeLessThan(count);
      }
    }
  });
});

describe("overlay freshness", () => {
  const video = { videoWidth: 1280, videoHeight: 720, currentTime: 1.5 };
  it("expires results after 500ms and rejects future results after a seek", () => {
    expect(isOverlayFrameCurrent(frame(), video)).toBe(true);
    expect(isOverlayFrameCurrent(frame(), { ...video, currentTime: 1.501 })).toBe(false);
    expect(isOverlayFrameCurrent(frame(), { ...video, currentTime: 0.9 })).toBe(false);
    expect(isOverlayFrameCurrent(null, video)).toBe(false);
  });
  it("rejects results from an obsolete source size", () => {
    expect(isOverlayFrameCurrent(frame(), { ...video, videoWidth: 720, videoHeight: 1280 })).toBe(false);
  });
});

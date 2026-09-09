import { describe, expect, it } from "vitest";
import { canvasBackingSize, containGeometry, mapImageLandmark } from "./overlayGeometry";

describe("contained overlay geometry", () => {
  it("maps a wide source through centered vertical letterboxing", () => {
    const geometry = containGeometry(1280, 720, 400, 400)!;
    expect(geometry).toMatchObject({ width: 400, height: 225, offsetX: 0, offsetY: 87.5 });
    expect(mapImageLandmark({ x: 0, y: 0 }, geometry)).toEqual({ x: 400, y: 87.5 });
    expect(mapImageLandmark({ x: 1, y: 1 }, geometry)).toEqual({ x: 0, y: 312.5 });
  });
  it("maps a portrait source through horizontal letterboxing and mirrors only x", () => {
    const geometry = containGeometry(480, 640, 600, 300)!;
    expect(geometry).toMatchObject({ width: 225, height: 300, offsetX: 187.5, offsetY: 0 });
    expect(mapImageLandmark({ x: 0, y: 0.5 }, geometry, false)).toEqual({ x: 187.5, y: 150 });
    expect(mapImageLandmark({ x: 0, y: 0.5 }, geometry)).toEqual({ x: 412.5, y: 150 });
    expect(mapImageLandmark({ x: 0.5, y: 0.5 }, geometry)).toEqual({ x: 300, y: 150 });
  });
  it("does not clamp out-of-frame domain coordinates", () => {
    const geometry = containGeometry(100, 100, 100, 100)!;
    expect(mapImageLandmark({ x: -0.2, y: 1.1 }, geometry)).toEqual({ x: 120, y: 110.00000000000001 });
  });
  it("rejects undecoded or invalid dimensions", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(containGeometry(invalid, 720, 400, 300)).toBeNull();
      expect(containGeometry(1280, 720, invalid, 300)).toBeNull();
    }
  });
  it("uses actual DPR for crisp backing pixels without changing CSS geometry", () => {
    expect(canvasBackingSize(333, 265, 1.5)).toEqual({ width: 500, height: 398, ratio: 1.5 });
    expect(canvasBackingSize(333, 265, 2)).toEqual({ width: 666, height: 530, ratio: 2 });
    expect(canvasBackingSize(333, 265, Number.NaN)).toEqual({ width: 333, height: 265, ratio: 1 });
  });
});

import { useEffect, useRef, type RefObject } from "react";
import type { LandmarkFrame } from "./model";
import { canvasBackingSize } from "./overlayGeometry";
import { isOverlayFrameCurrent, renderLandmarkFrame } from "./landmarkRenderer";

export function LandmarkOverlay({ video, frameRef }: { video: HTMLVideoElement | null; frameRef: RefObject<LandmarkFrame | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animationFrame = 0;
    let resizeNeeded = true;
    let width = 0;
    let height = 0;
    let ratio = 0;
    let previousFrame: LandmarkFrame | null | undefined;
    const requestResize = () => { resizeNeeded = true; };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(requestResize) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", requestResize);
    video.addEventListener("resize", requestResize);
    const draw = () => {
      const nextRatio = window.devicePixelRatio || 1;
      const resized = resizeNeeded || nextRatio !== ratio;
      if (resized) {
        const bounds = canvas.getBoundingClientRect();
        width = bounds.width;
        height = bounds.height;
        const backing = canvasBackingSize(width, height, nextRatio);
        ratio = backing.ratio;
        if (canvas.width !== backing.width) canvas.width = backing.width;
        if (canvas.height !== backing.height) canvas.height = backing.height;
        resizeNeeded = false;
      }
      const frame = isOverlayFrameCurrent(frameRef.current, video) ? frameRef.current : null;
      if (frame !== previousFrame || resized) {
        renderLandmarkFrame(context, frame, width, height, ratio);
        previousFrame = frame;
      }
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", requestResize);
      video.removeEventListener("resize", requestResize);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [video, frameRef]);
  return <canvas ref={canvasRef} className="landmark-overlay" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}

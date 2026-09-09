import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LocaleProvider } from "../../../i18n/LocaleProvider";
import { TrackingStatus } from "./TrackingStatus";
import type { LandmarkFrame } from "./model";

function emptyFrame(): LandmarkFrame {
  return { schemaVersion: 1, topology: "human-553-v1", trackingRunId: "run", sequence: 1, timestampMs: 1, source: { width: 640, height: 480, mirrored: false }, pose: null, face: null, leftHand: null, rightHand: null };
}
test("guidance stabilizes for one second and announcements are limited to once per five seconds", async () => {
  vi.useFakeTimers();
  const frameRef: { current: LandmarkFrame | null } = { current: emptyFrame() };
  const view = render(<LocaleProvider><TrackingStatus status="tracking" error={null} frameRef={frameRef} pause={vi.fn()} resume={vi.fn()} retry={vi.fn()} /></LocaleProvider>);
  const announcement = view.container.querySelector('.sr-only[role="status"]')!;
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(announcement.textContent).toBe("");
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(announcement).toHaveTextContent("Move into the camera view.");
  frameRef.current = { ...emptyFrame(), leftHand: { image: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })) } };
  await act(() => vi.advanceTimersByTimeAsync(1_250));
  expect(screen.getByText("One hand detected")).toBeVisible();
  expect(announcement).toHaveTextContent("Move into the camera view.");
  await act(() => vi.advanceTimersByTimeAsync(3_750));
  expect(announcement).toHaveTextContent("One hand detected");
  frameRef.current = null;
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(announcement.textContent).toBe("");
  expect(screen.queryByText("One hand detected")).not.toBeInTheDocument();
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
test("pausing removes detection polling and errors expose a separate retry action", async () => {
  vi.useFakeTimers();
  const frameRef = { current: emptyFrame() }; const retry = vi.fn();
  const props = { frameRef, pause: vi.fn(), resume: vi.fn(), retry };
  const view = render(<LocaleProvider><TrackingStatus {...props} status="tracking" error={null} /></LocaleProvider>);
  expect(screen.getByRole("button", { name: "Pause tracking" })).toBeVisible();
  view.rerender(<LocaleProvider><TrackingStatus {...props} status="paused" error={null} /></LocaleProvider>);
  expect(vi.getTimerCount()).toBe(0);
  expect(screen.getByRole("button", { name: "Resume tracking" })).toBeVisible();
  view.rerender(<LocaleProvider><TrackingStatus {...props} status="error" error="trackingPrivacyUnavailable" /></LocaleProvider>);
  expect(screen.getByRole("alert")).toHaveTextContent("privacy protections");
  act(() => screen.getByRole("button", { name: "Retry tracking" }).click());
  expect(retry).toHaveBeenCalledOnce();
});

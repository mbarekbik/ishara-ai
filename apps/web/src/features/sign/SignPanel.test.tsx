import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useSessionStore } from "../communication/sessionStore";
import { createMockSignService } from "./mockSignService";
import { SignPanel } from "./SignPanel";
import { startFrameScheduler } from "./tracking/frameScheduler";
import type { LandmarkTracker } from "./tracking/service";
import type { LandmarkFrame } from "./tracking/model";

vi.mock("./tracking/frameScheduler", () => ({ startFrameScheduler: vi.fn() }));
vi.mock("./tracking/LandmarkOverlay", () => ({ LandmarkOverlay: () => null }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  useSessionStore.setState({ session: null });
  useSessionStore.getState().ensureSession();
  vi.mocked(startFrameScheduler).mockReset();
});

function setup() {
  const track = new EventTarget() as EventTarget & { stop: () => void; readyState: string };
  track.stop = vi.fn();
  track.readyState = "live";
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const media = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: media } });
  const tracker = {
    initialize: vi.fn<LandmarkTracker["initialize"]>().mockResolvedValue(),
    detect: vi.fn<LandmarkTracker["detect"]>(),
    dispose: vi.fn<LandmarkTracker["dispose"]>().mockResolvedValue(),
  };
  const createTracker = vi.fn(() => tracker);
  const stopScheduling = vi.fn();
  vi.mocked(startFrameScheduler).mockReturnValue(stopScheduling);
  const view = render(
    <LocaleProvider>
      <LanguageSwitcher />
      <SignPanel session={useSessionStore.getState().session!}
        service={createMockSignService({ delayMs: 1 })} createTracker={createTracker} />
    </LocaleProvider>,
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
  const enable = async () => {
    await user.click(screen.getByRole("button", { name: "Enable camera" }));
    return view.container.querySelector("video")!;
  };
  const ready = async (video: HTMLVideoElement) => {
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
    });
    fireEvent.loadedData(video);
    await waitFor(() => expect(startFrameScheduler).toHaveBeenCalledOnce());
    const options = vi.mocked(startFrameScheduler).mock.calls[0][0];
    const frame: LandmarkFrame = {
      schemaVersion: 1, topology: "human-553-v1", trackingRunId: options.trackingRunId,
      sequence: 1, timestampMs: 100, source: { width: 1280, height: 720, mirrored: false },
      pose: null, face: null, leftHand: null, rightHand: null,
    };
    act(() => options.onFrame(frame));
    return options;
  };
  return { ...view, user, media, tracker, createTracker, stopScheduling, track, enable, ready };
}

test("camera permission is explicit and tracking waits for a decoded frame", async () => {
  const app = setup();
  expect(app.media).not.toHaveBeenCalled();
  expect(app.createTracker).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start Signing" })).toBeDisabled();
  const video = await app.enable();
  expect(app.media).toHaveBeenCalledOnce();
  expect(app.media).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  expect(app.createTracker).not.toHaveBeenCalled();
  await app.ready(video);
  expect(screen.getByText("Visual tracking active")).toBeVisible();
  expect(app.createTracker).toHaveBeenCalledOnce();
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
  app.unmount();
  expect(app.stopScheduling).toHaveBeenCalledOnce();
  expect(app.tracker.dispose).toHaveBeenCalledOnce();
  expect(app.track.stop).toHaveBeenCalledOnce();
});

test("participant and interface-language changes preserve camera and tracker ownership", async () => {
  const app = setup();
  await app.ready(await app.enable());
  await app.user.selectOptions(screen.getByLabelText("Speaking as"), "participant-2");
  await app.user.click(screen.getByRole("button", { name: "العربية" }));
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(app.media).toHaveBeenCalledOnce();
  expect(app.createTracker).toHaveBeenCalledOnce();
  expect(app.tracker.dispose).not.toHaveBeenCalled();
  expect(app.track.stop).not.toHaveBeenCalled();
  expect(app.stopScheduling).not.toHaveBeenCalled();
});

test("pausing disposes tracking while a mock turn stays usable without restarting tracking", async () => {
  const app = setup();
  await app.ready(await app.enable());
  await app.user.click(screen.getByRole("button", { name: "Pause tracking" }));
  expect(app.tracker.dispose).toHaveBeenCalledOnce();
  expect(app.track.stop).not.toHaveBeenCalled();
  await app.user.click(screen.getByRole("button", { name: "Start Signing" }));
  await app.user.click(screen.getByRole("button", { name: "Stop Signing" }));
  await waitFor(() => expect(useSessionStore.getState().session!.messages).toHaveLength(1));
  expect(useSessionStore.getState().session!.messages[0]).toMatchObject({
    source: "mock", inputType: "sign", text: "I have an appointment today.",
  });
  expect(screen.getByRole("button", { name: "Resume tracking" })).toBeVisible();
  expect(app.createTracker).toHaveBeenCalledOnce();
  expect(app.track.stop).not.toHaveBeenCalled();
});

test("an inference error preserves the camera and mock controls; late frames cannot add messages", async () => {
  const app = setup();
  const options = await app.ready(await app.enable());
  act(() => options.onError("trackingInferenceFailed"));
  expect(screen.getByRole("alert")).toHaveTextContent("Visual tracking was interrupted");
  expect(screen.getByRole("button", { name: "Retry tracking" })).toBeEnabled();
  expect(app.tracker.dispose).toHaveBeenCalledOnce();
  expect(app.track.stop).not.toHaveBeenCalled();
  act(() => options.onFrame({
    schemaVersion: 1, topology: "human-553-v1", trackingRunId: options.trackingRunId,
    sequence: 2, timestampMs: 200, source: { width: 1280, height: 720, mirrored: false },
    pose: null, face: null, leftHand: null, rightHand: null,
  }));
  expect(screen.queryByText("Visual tracking active")).toBeNull();
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
  await app.user.click(screen.getByRole("button", { name: "Start Signing" }));
  await app.user.click(screen.getByRole("button", { name: "Stop Signing" }));
  await waitFor(() => expect(useSessionStore.getState().session!.messages).toHaveLength(1));
  expect(app.createTracker).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Retry tracking" })).toBeEnabled();
});

test("camera-free demo releases the camera and tracking without requiring another permission", async () => {
  const app = setup();
  await app.ready(await app.enable());
  await app.user.click(screen.getByRole("button", { name: "Use camera-free demo" }));
  expect(app.track.stop).toHaveBeenCalledOnce();
  expect(app.tracker.dispose).toHaveBeenCalledOnce();
  expect(app.container.querySelector("video")).toBeNull();
  expect(screen.getByRole("button", { name: "Start Signing" })).toBeEnabled();
  expect(app.media).toHaveBeenCalledOnce();
});

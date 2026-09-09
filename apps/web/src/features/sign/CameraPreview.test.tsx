import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { CameraPreview } from "./CameraPreview";

test("attaches one stable video node across locale changes and detaches without owning tracks", () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const videoRef = createRef<HTMLVideoElement>();
  const onVideo = vi.fn();
  const { unmount } = render(
    <LocaleProvider>
      <LanguageSwitcher />
      <CameraPreview stream={stream} videoRef={videoRef} onVideo={onVideo} />
    </LocaleProvider>,
  );
  const video = videoRef.current!;
  expect(video.srcObject).toBe(stream);
  expect(video.autoplay).toBe(true);
  expect(video.muted).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(onVideo).toHaveBeenCalledExactlyOnceWith(video);

  fireEvent.click(screen.getByRole("button", { name: "العربية" }));
  expect(videoRef.current).toBe(video);
  expect(video.srcObject).toBe(stream);
  expect(onVideo).toHaveBeenCalledOnce();
  expect(document.documentElement).toHaveAttribute("dir", "rtl");

  unmount();
  expect(video.srcObject).toBeNull();
  expect(videoRef.current).toBeNull();
  expect(onVideo).toHaveBeenLastCalledWith(null);
  expect(stop).not.toHaveBeenCalled();
});

test("replaces the preview source without replacing its video node or stopping either stream", () => {
  const stop = vi.fn();
  const first = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const second = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const videoRef = createRef<HTMLVideoElement>();
  const onVideo = vi.fn();
  const preview = (stream: MediaStream) => <LocaleProvider>
    <CameraPreview stream={stream} videoRef={videoRef} onVideo={onVideo} />
  </LocaleProvider>;
  const { rerender, unmount } = render(preview(first));
  const video = videoRef.current!;
  rerender(preview(second));
  expect(videoRef.current).toBe(video);
  expect(video.srcObject).toBe(second);
  expect(onVideo).toHaveBeenCalledOnce();
  unmount();
  expect(video.srcObject).toBeNull();
  expect(stop).not.toHaveBeenCalled();
});

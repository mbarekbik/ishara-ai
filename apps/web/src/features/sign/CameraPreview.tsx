import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "../../i18n/useTranslation";
export function CameraPreview({
  stream,
  videoRef,
  onVideo,
}: {
  stream: MediaStream;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideo?: (video: HTMLVideoElement | null) => void;
}) {
  const internal = useRef<HTMLVideoElement | null>(null);
  const { t } = useTranslation();
  const attach = useCallback((element: HTMLVideoElement | null) => {
    internal.current = element;
    videoRef.current = element;
    onVideo?.(element);
  }, [videoRef, onVideo]);
  useEffect(() => {
    const video = internal.current;
    if (video) video.srcObject = stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <video
        ref={attach}
        autoPlay
        muted
        playsInline
        className="camera-video"
        aria-label={t("cameraReady")}
      />
      <span className="preview-caption">{t("cameraLocal")}</span>
    </>
  );
}

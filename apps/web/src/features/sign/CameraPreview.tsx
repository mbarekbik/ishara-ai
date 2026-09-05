import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "../../i18n/useTranslation";
export function CameraPreview({
  stream,
  videoRef,
}: {
  stream: MediaStream;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const internal = useRef<HTMLVideoElement | null>(null);
  const { t } = useTranslation();
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
        ref={(element) => {
          internal.current = element;
          videoRef.current = element;
        }}
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

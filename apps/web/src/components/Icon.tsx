import type { CSSProperties } from "react";
export type IconName =
  | "sign"
  | "voice"
  | "arrow"
  | "chat"
  | "shield"
  | "camera"
  | "spark"
  | "stop"
  | "check";
const paths: Record<IconName, string> = {
  sign: "M8 13V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-3l2 3Z",
  voice:
    "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  chat: "M21 11a9 9 0 0 1-9 9H4l-3 2 2-7a9 9 0 1 1 18-4ZM7 10h10M7 14h6",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6",
  camera: "M3 7h4l2-3h6l2 3h4v14H3V7Zm13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  stop: "M6 6h12v12H6Z",
  check: "m5 12 4 4L20 5",
};
export function Icon({
  name,
  size = 24,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={name === "arrow" ? "directional-icon" : ""}
    >
      <path d={paths[name]} />
    </svg>
  );
}

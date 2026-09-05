import type { ReactNode } from "react";
export function StatusNotice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`status-notice ${error ? "status-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-atomic="true"
    >
      <span className="status-dot" aria-hidden="true" />
      {children}
    </div>
  );
}

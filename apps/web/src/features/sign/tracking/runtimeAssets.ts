import assets from "../../../../vision-assets.json";
import { TrackingError } from "./model";

/** Also used by the Vite response middleware; no global page policy is changed. */
export const TRACKING_WORKER_POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'";

export async function loadTrackingAssets(workerUrl: string, baseUrl: string, fetcher: typeof fetch = fetch) {
  // Static hosting must serve this header too. Do not silently enable SDK telemetry
  // when a deployment omits the worker-specific protection.
  try {
    const response = await fetcher(workerUrl, { method: "HEAD", cache: "no-store", credentials: "omit" });
    if (!response.ok || response.headers.get("Content-Security-Policy")?.trim() !== TRACKING_WORKER_POLICY) throw new Error("Missing worker policy");
  } catch { throw new TrackingError("trackingPrivacyUnavailable"); }
  try {
    const wasmPath = new URL(assets.wasmPath, baseUrl).href;
    const [response, loader, binary] = await Promise.all([
      fetcher(new URL(assets.model.path, baseUrl).href, { credentials: "omit" }),
      fetcher(`${wasmPath}/vision_wasm_module_internal.js`, { method: "HEAD", credentials: "omit" }),
      fetcher(`${wasmPath}/vision_wasm_module_internal.wasm`, { method: "HEAD", credentials: "omit" }),
    ]);
    if (!response.ok || !loader.ok || !binary.ok) throw new Error("Missing local asset");
    // A SPA fallback must never be mistaken for a successful WASM/model response.
    if ([response, loader, binary].some(item => item.headers.get("Content-Type")?.includes("text/html"))) throw new Error("Invalid local asset");
    const model = new Uint8Array(await response.arrayBuffer());
    if (model.byteLength !== assets.model.bytes) throw new Error("Incomplete model");
    return { model, wasmPath };
  } catch { throw new TrackingError("trackingAssetsUnavailable"); }
}

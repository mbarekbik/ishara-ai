import { expect, test, vi } from "vitest";
import assets from "../../../../vision-assets.json";
import { loadTrackingAssets, TRACKING_WORKER_POLICY } from "./runtimeAssets";

function setup() {
  return vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes("worker.js")) return new Response(null, { headers: { "Content-Security-Policy": TRACKING_WORKER_POLICY } });
    if (String(url).endsWith(".task")) return new Response(new Uint8Array(assets.model.bytes));
    return new Response(null);
  });
}
test("verifies worker-only privacy policy and local assets before creating a detector", async () => {
  const fetcher = setup();
  const result = await loadTrackingAssets("https://ishara.test/worker.js", "https://ishara.test/", fetcher);
  expect(result.model.byteLength).toBe(assets.model.bytes);
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://ishara.test/"))).toBe(true);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "HEAD", cache: "no-store", credentials: "omit" });
});
test("fails closed before model loading when a static deployment omits CSP", async () => {
  const fetcher = setup().mockResolvedValueOnce(new Response(null));
  await expect(loadTrackingAssets("https://ishara.test/worker.js", "https://ishara.test/", fetcher)).rejects.toMatchObject({ code: "trackingPrivacyUnavailable" });
  expect(fetcher).toHaveBeenCalledOnce();
});
test.each(["rejection", "missing", "spa-fallback", "truncated"])("classifies %s model/WASM responses as asset failures", async (fault) => {
  const fetcher = setup().mockImplementation(async (url) => {
    if (String(url).endsWith("worker.js")) return new Response(null, { headers: { "Content-Security-Policy": TRACKING_WORKER_POLICY } });
    if (fault === "rejection") throw new TypeError("Synthetic offline failure");
    if (fault === "missing") return new Response(null, { status: 404 });
    if (fault === "spa-fallback") return new Response("app", { headers: { "Content-Type": "text/html" } });
    return new Response(new Uint8Array(4));
  });
  await expect(loadTrackingAssets("https://ishara.test/worker.js", "https://ishara.test/", fetcher)).rejects.toMatchObject({ code: "trackingAssetsUnavailable" });
});

import { expect, test } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { app, createApp } from "./app.js";
test("health endpoint is available without external services", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("conversation composition leaves health and Live configuration independent", async () => {
  const composed = createApp({ enabled: false, allowedOrigins: [] }, undefined,
    { enabled: true, allowedOrigins: ["http://127.0.0.1:5173"] },
    async () => ({ reply: "Synthetic reply", language: "en" }));
  expect(composed.get("trust proxy")).toBe(false);
  const server = composed.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ status: "ok" });
    expect(await (await fetch(`${base}/api/ai/live-config`)).json()).toEqual({ enabled: false, maxTurnSeconds: 120, speechLanguages: ["auto", "en", "ar"] });
    expect(await (await fetch(`${base}/api/ai/conversation-config`)).json()).toMatchObject({ enabled: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

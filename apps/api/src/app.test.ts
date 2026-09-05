import { expect, test } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { app } from "./app.js";
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

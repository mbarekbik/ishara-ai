import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { conversationRoutes } from "./routes.js";
import { CONVERSATION_LIMITS, ConversationError, type ConversationReply, type ConversationService } from "./contract.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const input = { responseLanguage: "auto", messages: [
  { speaker: "participant-1", text: "Synthetic appointment today.", language: "en", source: "service" },
] };
const reply: ConversationReply = { reply: "What would you like to clarify?", language: "en" };
async function setup(options: { enabled?: boolean; service?: ConversationService; absentCredential?: boolean; deadlineMs?: number } = {}) {
  const service = options.service ?? vi.fn<ConversationService>().mockResolvedValue(reply);
  const app = express();
  app.set("trust proxy", false);
  // Test-only socket identity injection exercises multiple clients without
  // configuring trusted proxies or accepting forwarded headers in production.
  app.use((request, _response, next) => {
    if (request.get("x-test-client")) Object.defineProperty(request, "ip", { value: request.get("x-test-client") });
    next();
  });
  app.use("/api/ai", conversationRoutes({ enabled: options.enabled ?? true, allowedOrigins: ["http://127.0.0.1:5173"] },
    options.absentCredential ? undefined : service, { deadlineMs: options.deadlineMs }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function post(body: unknown = input, options: { origin?: string; client?: string; raw?: boolean; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
    return fetch(`${base}/api/ai/respond`, { method: "POST", signal: options.signal,
      headers: { Origin: options.origin ?? "http://127.0.0.1:5173", "Content-Type": "application/json",
        ...(options.client ? { "x-test-client": options.client } : {}), ...options.headers },
      body: options.raw ? String(body) : JSON.stringify(body),
    });
  }
  return { base, post, service };
}
test("configuration is safe and credential-free with independent disabled default", async () => {
  const { base, post, service } = await setup({ enabled: false });
  const response = await fetch(`${base}/api/ai/conversation-config`);
  expect(await response.json()).toEqual({ enabled: false, responseLanguages: ["auto", "en", "ar"], limits: CONVERSATION_LIMITS });
  expect(response.headers.get("cache-control")).toBe("no-store");
  const disabled = await post();
  expect(disabled.status).toBe(503);
  expect(await disabled.json()).toEqual({ error: { code: "AI_UNAVAILABLE", retryable: true } });
  expect(service).not.toHaveBeenCalled();
});
test("enabled flag without credentials stays unavailable", async () => {
  const { base, post } = await setup({ absentCredential: true });
  expect(await (await fetch(`${base}/api/ai/conversation-config`)).json()).toMatchObject({ enabled: false });
  expect((await post()).status).toBe(503);
});
test("enabled config never generates and POST returns only the application response", async () => {
  const { base, post, service } = await setup();
  expect(await (await fetch(`${base}/api/ai/conversation-config`)).json()).toMatchObject({ enabled: true });
  expect(service).not.toHaveBeenCalled();
  const response = await post();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(reply);
  expect(service).toHaveBeenCalledWith(input, expect.any(AbortSignal));
});
test.each(["", "http://localhost:5173", "http://127.0.0.1:5174", "https://attacker.example", "null"])("rejects unmatched or missing Origin %s", async (origin) => {
  const { post, service } = await setup();
  const response = await post(input, { origin });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { code: "AI_FORBIDDEN", retryable: false } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(service).not.toHaveBeenCalled();
});
test.each(["{", "[]", JSON.stringify({ ...input, model: "other" }), JSON.stringify({ ...input, responseLanguage: "fr" })])("rejects malformed or over-broad payload %#", async (body) => {
  const { post, service } = await setup();
  const response = await post(body, { raw: true });
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(service).not.toHaveBeenCalled();
});
test("rejects oversized serialized requests before generation", async () => {
  const { post, service } = await setup();
  const response = await post({ ...input, padding: "x".repeat(65_536) });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: { code: "AI_MESSAGE_TOO_LARGE", retryable: false } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(service).not.toHaveBeenCalled();
});
test("rejects non-JSON and encoded bodies", async () => {
  const { post, service } = await setup();
  expect((await post(input, { headers: { "Content-Type": "text/plain" } })).status).toBe(400);
  expect((await post(input, { headers: { "Content-Encoding": "gzip" } })).status).toBe(400);
  expect(service).not.toHaveBeenCalled();
});
test("failed attempts consume six-per-client limit and forwarded IP cannot bypass it", async () => {
  const { post, service } = await setup();
  for (let index = 0; index < 6; index++) {
    expect((await post({}, { headers: { "X-Forwarded-For": `192.0.2.${index + 1}` } })).status).toBe(400);
  }
  const response = await post();
  expect(response.status).toBe(429);
  const retry = Number(response.headers.get("retry-after"));
  expect(retry).toBeGreaterThan(0);
  expect(await response.json()).toEqual({ error: { code: "AI_RATE_LIMITED", retryable: true, retryAfterSeconds: retry } });
  expect(service).not.toHaveBeenCalled();
});
test("thirty attempts across distinct clients exhaust the global limit", async () => {
  const { post, service } = await setup();
  for (let index = 1; index <= 30; index++) expect((await post({}, { client: `192.0.2.${index}` })).status).toBe(400);
  const response = await post(input, { client: "192.0.2.31" });
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(service).not.toHaveBeenCalled();
});
test("only one generation per client and two globally run, without queuing", async () => {
  const completions: Array<(reply: ConversationReply) => void> = [];
  const service = vi.fn<ConversationService>().mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
  const { post } = await setup({ service });
  const first = post(input, { client: "192.0.2.1" });
  await vi.waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  const duplicate = await post(input, { client: "192.0.2.1" });
  expect(duplicate.status).toBe(429);
  expect(duplicate.headers.get("retry-after")).toBe("1");
  const second = post(input, { client: "192.0.2.2" });
  await vi.waitFor(() => expect(service).toHaveBeenCalledTimes(2));
  expect((await post(input, { client: "192.0.2.3" })).status).toBe(429);
  expect(service).toHaveBeenCalledTimes(2);
  completions.forEach((resolve) => resolve(reply));
  expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  service.mockResolvedValue(reply);
  expect((await post(input, { client: "192.0.2.3" })).status).toBe(200);
});
test("deadline aborts and releases capacity even when provider ignores cancellation", async () => {
  let signal: AbortSignal | undefined;
  let complete!: (reply: ConversationReply) => void;
  const service = vi.fn<ConversationService>().mockImplementation((_request, abortSignal) => {
    signal = abortSignal;
    return new Promise((resolve) => { complete = resolve; });
  });
  const { post } = await setup({ service, deadlineMs: 20 });
  const response = await post();
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ error: { code: "AI_TIMEOUT", retryable: true } });
  expect(signal!.aborted).toBe(true);
  complete(reply);
  service.mockResolvedValue(reply);
  expect((await post()).status).toBe(200);
});
test("client disconnect aborts the provider and releases its concurrency slot", async () => {
  let providerSignal: AbortSignal | undefined;
  const service = vi.fn<ConversationService>().mockImplementation((_request, signal) => {
    providerSignal = signal;
    return new Promise(() => undefined);
  });
  const { post } = await setup({ service });
  const controller = new AbortController();
  const pending = post(input, { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(service).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejection;
  await vi.waitFor(() => expect(providerSignal!.aborted).toBe(true));
  service.mockResolvedValue(reply);
  expect((await post()).status).toBe(200);
});
test("provider failures remain sanitized without logging conversation or raw payloads", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const { post } = await setup({ service: async () => { throw new Error("sensitive upstream body"); } });
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: { code: "AI_UPSTREAM_ERROR", retryable: true } });
  expect(log).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled();
});
test("declined generation returns a stable non-success response", async () => {
  const { post } = await setup({ service: async () => { throw new ConversationError("AI_DECLINED", 422); } });
  const response = await post();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: { code: "AI_DECLINED", retryable: false } });
});

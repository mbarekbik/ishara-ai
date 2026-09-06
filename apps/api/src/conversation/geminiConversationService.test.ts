import { afterEach, expect, test, vi } from "vitest";
import { createGeminiConversationService } from "./geminiConversationService.js";
import { ISHARA_CONVERSATION_INSTRUCTION_V1 } from "./systemInstruction.js";
import type { ConversationRequest } from "./contract.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request: ConversationRequest = { responseLanguage: "auto", messages: [
  { speaker: "participant-1", text: "Synthetic appointment Tuesday, not Thursday.", language: "en", source: "service" },
] };
function interaction(output: unknown = { outcome: "reply", text: "Would you like to confirm Tuesday?", language: "en" }, status = "completed") {
  return { id: "synthetic-interaction", status, steps: [
    { type: "thought", summary: "never expose reasoning" },
    { type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] },
  ] };
}
function fakeHttp(body: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
test("installed SDK serializes the stateless constrained non-streaming Interactions request", async () => {
  const fetcher = fakeHttp(interaction());
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const result = await createGeminiConversationService("synthetic-test-credential")(request, new AbortController().signal);
  expect(result).toEqual({ reply: "Would you like to confirm Tuesday?", language: "en" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const sent = fetcher.mock.calls[0][0] as Request;
  expect(sent.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  const body = await sent.json();
  expect(body).toMatchObject({ model: "gemini-3.8-flash", store: false, stream: false, background: false,
    system_instruction: ISHARA_CONVERSATION_INSTRUCTION_V1,
    generation_config: { thinking_level: "low", max_output_tokens: 1_024 },
    response_format: { type: "text", mime_type: "application/json", schema: { additionalProperties: false } },
  });
  expect(Object.keys(body).sort()).toEqual(["background", "generation_config", "input", "model", "response_format", "store", "stream", "system_instruction"]);
  expect(JSON.parse(body.input).messages).toEqual(request.messages);
  expect(JSON.stringify(body)).not.toContain("synthetic-test-credential");
  expect(log).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled();
});
test.each(["incomplete", "failed", "budget_exceeded", "in_progress", "requires_action"])("rejects %s interactions", async (status) => {
  fakeHttp(interaction(undefined, status));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toThrow("AI_INVALID_RESPONSE");
});
test.each([
  { outcome: "reply", text: "", language: "en" },
  { outcome: "reply", text: "x".repeat(601), language: "en" },
  { outcome: "reply", text: "Hi", language: "fr" },
  { extra: true },
])("rejects unusable structured provider output %#", async (output) => {
  fakeHttp(interaction(output));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toThrow("AI_INVALID_RESPONSE");
});
test.each([
  [{ outcome: "declined", text: "", language: "und" }, "AI_DECLINED"],
  [{ outcome: "language_required", text: "", language: "und" }, "AI_LANGUAGE_REQUIRED"],
])("normalizes non-reply outcome %#", async (output, code) => {
  fakeHttp(interaction(output));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toThrow(String(code));
});
test("does not extract model output from thought or tool content and rejects malformed JSON", async () => {
  const fetcher = fakeHttp({ id: "synthetic", status: "completed", steps: [{ type: "thought", text: JSON.stringify({ outcome: "reply", text: "secret", language: "en" }) }] });
  const service = createGeminiConversationService("synthetic");
  await expect(service(request, new AbortController().signal)).rejects.toThrow("AI_INVALID_RESPONSE");
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: "synthetic", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "not json" }] }] }), { headers: { "Content-Type": "application/json" } }));
  await expect(service(request, new AbortController().signal)).rejects.toThrow("AI_INVALID_RESPONSE");
});
test.each([[429, "AI_RATE_LIMITED"], [503, "AI_UPSTREAM_UNAVAILABLE"], [401, "AI_UPSTREAM_ERROR"]])("sanitizes HTTP %s and disables automatic retries", async (status, code) => {
  const fetcher = fakeHttp({ error: { code: status, message: "provider payload must not escape", status: "UNAVAILABLE" } }, Number(status));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toThrow(String(code));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("installed SDK connection errors become temporary unavailability without retry or raw details", async () => {
  const fetcher = fakeHttp(interaction());
  fetcher.mockRejectedValueOnce(new TypeError("fetch failed: synthetic private transport details"));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toMatchObject({
    message: "AI_UPSTREAM_UNAVAILABLE", code: "AI_UPSTREAM_UNAVAILABLE", status: 503, retryable: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("installed SDK connection-timeout wrapper remains a timeout", async () => {
  const fetcher = fakeHttp(interaction());
  fetcher.mockRejectedValueOnce(new DOMException("synthetic timeout details", "TimeoutError"));
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toMatchObject({
    message: "AI_TIMEOUT", code: "AI_TIMEOUT", status: 504, retryable: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("unrecognized provider fault codes fail closed without inferring a safety outcome from text", async () => {
  fakeHttp({ ...interaction(), errors: [{ code: "https://provider.example/unrecognized-fault", message: "synthetic safety-shaped text" }] });
  await expect(createGeminiConversationService("synthetic")(request, new AbortController().signal)).rejects.toMatchObject({
    message: "AI_INVALID_RESPONSE", code: "AI_INVALID_RESPONSE", status: 502,
  });
});
test("AbortSignal reaches the installed SDK HTTP request and cancelled output cannot settle", async () => {
  let received: Request | undefined;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
    received = input as Request;
    started();
    return new Promise<Response>((_resolve, reject) => received!.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
  }));
  const controller = new AbortController();
  const promise = createGeminiConversationService("synthetic")(request, controller.signal);
  const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  await entered;
  controller.abort();
  await assertion;
  expect(received!.signal.aborted).toBe(true);
});

import { expect, test, vi } from "vitest";
import { createGeminiConversationService } from "./geminiConversationService";
import { AI_LIMITS, type AIRequest } from "./service";

const input: AIRequest = { responseLanguage: "en", messages: [{ speaker: "participant-1", text: "Not before 3 PM.", language: "en", source: "service" }] };
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers });

test("sends only the bounded DTO through same-origin POST and returns source service", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ reply: "Would you like a later appointment?", language: "en" }));
  const service = createGeminiConversationService(fetcher);
  const output = await service.reply({ ...input, signal: new AbortController().signal });
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("/api/ai/respond");
  expect(request).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
  expect(JSON.parse(request!.body as string)).toEqual(input);
  expect(output).toMatchObject({ source: "service", language: "en" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("configuration does not create a reply and rejects incompatible limits", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ enabled: false, responseLanguages: ["auto", "en", "ar"], limits: AI_LIMITS }))
    .mockResolvedValueOnce(json({ enabled: true, responseLanguages: ["auto", "en", "ar"], limits: { ...AI_LIMITS, maxMessages: 100 } }));
  const service = createGeminiConversationService(fetcher);
  expect(await service.getConfig!(new AbortController().signal)).toMatchObject({ enabled: false });
  expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  await expect(service.getConfig!(new AbortController().signal)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
});
test.each([
  { reply: "", language: "en" }, { reply: "x".repeat(601), language: "en" },
  { reply: "مرحبا", language: "ar" }, { reply: "hello", language: "und" }, { output_text: "provider object" },
])("rejects unusable success response without returning a fixture: %j", async (response) => {
  const service = createGeminiConversationService(vi.fn<typeof fetch>().mockResolvedValue(json(response)));
  await expect(service.reply({ ...input, signal: new AbortController().signal })).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
});
test("keeps only allowlisted error information and Retry-After", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { code: "AI_RATE_LIMITED", retryable: true, message: "private provider payload" } }, 429, { "Retry-After": "30" }));
  const error = await createGeminiConversationService(fetcher).reply({ ...input, signal: new AbortController().signal }).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "AI_RATE_LIMITED", retryable: true, retryAfterSeconds: 30 });
  expect(String(error)).not.toContain("private");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("network failure never performs an automatic retry or returns mock text", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("raw transport detail"));
  await expect(createGeminiConversationService(fetcher).reply({ ...input, signal: new AbortController().signal })).rejects.toMatchObject({ code: "AI_NETWORK_ERROR" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("aborts on the deadline even when an injected fetch ignores its signal", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));
  const promise = createGeminiConversationService(fetcher).reply({ ...input, signal: new AbortController().signal });
  const assertion = expect(promise).rejects.toMatchObject({ code: "AI_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(25_000);
  await assertion;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
test("explicit cancellation aborts transport and discards a late HTTP response", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(new Promise((settle) => { resolve = settle; }));
  const controller = new AbortController();
  const promise = createGeminiConversationService(fetcher).reply({ ...input, signal: controller.signal });
  const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await assertion;
  resolve(json({ reply: "Late", language: "en" }));
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
test("oversized serialized requests are rejected before fetch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const messages = [{ ...input.messages[0], text: "\u0000".repeat(12_000) }];
  await expect(createGeminiConversationService(fetcher).reply({ ...input, messages, signal: new AbortController().signal })).rejects.toMatchObject({ code: "AI_MESSAGE_TOO_LARGE" });
  expect(fetcher).not.toHaveBeenCalled();
});

import { expect, test, vi } from "vitest";
import { mockCapture } from "./capture";
test("mock cancellation rejects pending work and finish is idempotent", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const operation = mockCapture(
    { text: "Hello", language: "en", source: "mock" },
    controller.signal,
  );
  const first = operation.finish();
  expect(operation.finish()).toBe(first);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  operation.cancel();
  operation.cancel();
});

import { expect, test } from "vitest";
import type { Message } from "../communication/model";
import { selectAIContext, utf8Bytes } from "./context";
import { AI_LIMITS } from "./service";

function message(id: string, text = id, overrides: Partial<Message> = {}): Message {
  return { id, text, sender: { id: "participant-1", kind: "human" }, inputType: "voice", language: "en",
    source: "service", createdAt: "2026-09-06T00:00:00Z", ...overrides };
}
const assistant = (id: string, source: Message["source"] = "service") => message(id, id, { sender: { id: "assistant", kind: "assistant" }, inputType: "ai", source });

test("keeps the last 12 eligible messages in insertion order without duplicating latest", () => {
  const history = Array.from({ length: 15 }, (_, index) => message(String(index)));
  const selected = selectAIContext(history);
  expect(selected.messages.map((item) => item.text)).toEqual(history.slice(3).map((item) => item.text));
  expect(selected.omittedCount).toBe(3);
  expect(selected.messages.at(-1)?.text).toBe("14");
});
test("excludes mock assistant replies, includes mock humans, and removes orphan assistant prefix", () => {
  const selected = selectAIContext([assistant("orphan"), message("human", "sample", { source: "mock" }),
    assistant("demo", "mock"), assistant("real"), message("follow-up")]);
  expect(selected.messages.map((item) => item.text)).toEqual(["sample", "real", "follow-up"]);
  expect(selected.messages[0].source).toBe("mock");
  expect(selected.omittedCount).toBe(2);
});
test("counts UTF-8 bytes, drops whole old turns and accepts exact per-message boundary", () => {
  const arabic = "أ".repeat(4096);
  expect(utf8Bytes(arabic)).toBe(AI_LIMITS.maxMessageBytes);
  const selected = selectAIContext([message("old", "negation: do not remove"), message("1", arabic), message("2", arabic)]);
  expect(selected.messages).toHaveLength(2);
  expect(selected.messages[0].text).toBe(arabic);
  expect(selected.omittedCount).toBe(1);
  expect(() => selectAIContext([message("huge", arabic + "أ")])).toThrow("AI_MESSAGE_TOO_LARGE");
});
test("does not skip over an oversized older turn to invent a disconnected context window", () => {
  const selected = selectAIContext([message("old"), message("large", "x".repeat(8193)), message("latest")]);
  expect(selected.messages.map((item) => item.text)).toEqual(["latest"]);
  expect(selected.omittedCount).toBe(2);
});
test("preserves negation, dates, numbers, repetition and mixed direction while removing private metadata", () => {
  const text = "I did NOT take 5 mg on 06/09/2026. No, no. لست متأكداً — 3 PM.";
  const original = message("private-id", text, { language: "mul", confidence: 0.8 });
  Object.freeze(original);
  const selected = selectAIContext([original]);
  expect(selected.messages).toEqual([{ speaker: "participant-1", text, language: "mul", source: "service" }]);
  expect(JSON.stringify(selected)).not.toContain("private-id");
});
test("rejects absent human turn and malformed identity or language metadata", () => {
  expect(() => selectAIContext([])).toThrow("AI_NO_HUMAN_MESSAGE");
  expect(() => selectAIContext([message("1"), assistant("2")])).toThrow("AI_NO_HUMAN_MESSAGE");
  expect(() => selectAIContext([message("1", "hello", { sender: { id: "doctor", kind: "human" } })])).toThrow("AI_INVALID_REQUEST");
  expect(() => selectAIContext([message("1", "hello", { language: "en<script>" })])).toThrow("AI_INVALID_REQUEST");
});

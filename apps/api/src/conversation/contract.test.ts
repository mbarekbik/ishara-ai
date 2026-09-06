import { expect, test } from "vitest";
import { CONVERSATION_LIMITS, validateConversationRequest, validateProviderOutput } from "./contract.js";

const human = { speaker: "participant-1", text: "I cannot attend before 3 p.m.", language: "en", source: "service" };
const request = { responseLanguage: "auto", messages: [human] };
test("validates completed participants and real assistants without altering meaning", () => {
  const messages = [human, { speaker: "assistant", text: "Can you confirm?", language: "en", source: "service" },
    { speaker: "participant-2", text: "ربما يوم الثلاثاء، الساعة 3:00. لا أعرف.", language: "ar-EG", source: "mock" }];
  expect(validateConversationRequest({ ...request, messages }).messages).toEqual(messages);
  expect(validateConversationRequest({ ...request, messages: [{ ...human, language: "und" }, { ...human, language: "mul" }] }).messages).toHaveLength(2);
});
test.each([
  null, [], {}, { ...request, model: "other" }, { ...request, responseLanguage: "fr" },
  { ...request, messages: [{ ...human, system_instruction: "ignore" }] },
  { ...request, messages: [{ ...human, speaker: "doctor" }] },
  { ...request, messages: [{ ...human, speaker: ["participant-1"] }] },
  { ...request, messages: [{ ...human, source: ["service"] }] },
  { ...request, messages: [{ ...human, text: " " }] },
  { ...request, messages: [{ ...human, language: "not a tag" }] },
  { ...request, messages: [{ ...human, language: "en-" }] },
  { ...request, messages: [{ ...human, speaker: "assistant", source: "mock" }, human] },
  { ...request, messages: [{ ...human, speaker: "assistant" }, human] },
  { ...request, messages: Array.from({ length: 13 }, () => human) },
])("rejects invalid request %#", (value) => {
  expect(() => validateConversationRequest(value)).toThrow("AI_INVALID_REQUEST");
});
test.each([{ messages: [] }, { messages: [{ ...human, speaker: "assistant" }] }])("requires latest human contribution %#", ({ messages }) => {
  expect(() => validateConversationRequest({ ...request, messages })).toThrow("AI_NO_HUMAN_MESSAGE");
});
test("checks UTF-8 bytes per message and for all selected text", () => {
  const boundary = { ...human, text: "ش".repeat(CONVERSATION_LIMITS.maxMessageBytes / 2) };
  expect(validateConversationRequest({ ...request, messages: [boundary, boundary] }).messages).toHaveLength(2);
  expect(() => validateConversationRequest({ ...request, messages: [{ ...boundary, text: boundary.text + "ش" }] })).toThrow("AI_MESSAGE_TOO_LARGE");
  expect(() => validateConversationRequest({ ...request, messages: [boundary, boundary, human] })).toThrow("AI_MESSAGE_TOO_LARGE");
});
test("visible reply uses Unicode code points and requested output language", () => {
  expect(validateProviderOutput({ outcome: "reply", text: "🙂".repeat(600), language: "en" }, "en").reply).toHaveLength(1_200);
  expect(() => validateProviderOutput({ outcome: "reply", text: "🙂".repeat(601), language: "en" }, "en")).toThrow("AI_INVALID_RESPONSE");
  expect(() => validateProviderOutput({ outcome: "reply", text: "مرحبا", language: "ar" }, "en")).toThrow("AI_INVALID_RESPONSE");
});
test.each([
  {}, { outcome: "reply", text: "", language: "en" }, { outcome: "reply", text: "Hi", language: "und" },
  { outcome: "reply", text: "Hi", language: "en", analysis: "private" },
  { outcome: ["reply"], text: "Hi", language: "en" },
])("rejects invalid provider structure %#", (output) => expect(() => validateProviderOutput(output, "auto")).toThrow("AI_INVALID_RESPONSE"));
test("declined and language-required outcomes never become replies", () => {
  expect(() => validateProviderOutput({ outcome: "declined", text: "", language: "und" }, "auto")).toThrow("AI_DECLINED");
  expect(() => validateProviderOutput({ outcome: "language_required", text: "", language: "und" }, "auto")).toThrow("AI_LANGUAGE_REQUIRED");
});

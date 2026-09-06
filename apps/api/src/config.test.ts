import { expect, test } from "vitest";
import { readConfig } from "./config.js";

test("both external features default disabled and preserve loopback development origins", () => {
  const config = readConfig({});
  expect(config.port).toBe(3001);
  expect(config.live.enabled).toBe(false);
  expect(config.conversation.enabled).toBe(false);
  expect(config.conversation.allowedOrigins).toEqual(["http://127.0.0.1:5173", "http://localhost:5173"]);
});
test("conversation and Voice flags and origins are independent", () => {
  const config = readConfig({ LIVE_TRANSCRIPTION_ENABLED: "true", AI_CONVERSATION_ENABLED: "false",
    LIVE_ALLOWED_ORIGINS: "https://voice.example", AI_ALLOWED_ORIGINS: "https://conversation.example" });
  expect(config.live.enabled).toBe(true);
  expect(config.conversation.enabled).toBe(false);
  expect(config.live.allowedOrigins).toEqual(["https://voice.example"]);
  expect(config.conversation.allowedOrigins).toEqual(["https://conversation.example"]);
  expect(readConfig({ AI_CONVERSATION_ENABLED: "true" }).live.enabled).toBe(false);
});
test.each(["*", "http://localhost:5173/", "https://example.test/path", "file:///example", "", "null"])("rejects non-exact conversation origin %s", (origin) => {
  expect(() => readConfig({ AI_ALLOWED_ORIGINS: origin })).toThrow("AI_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
});
test("rejects invalid flags without echoing configuration values", () => {
  expect(() => readConfig({ AI_CONVERSATION_ENABLED: "invalid-sensitive-value" })).toThrow("AI_CONVERSATION_ENABLED must be true or false");
  expect(() => readConfig({ LIVE_TRANSCRIPTION_ENABLED: "yes" })).toThrow("LIVE_TRANSCRIPTION_ENABLED must be true or false");
});

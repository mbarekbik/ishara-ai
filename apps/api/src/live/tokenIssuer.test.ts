import { afterEach, expect, test, vi } from "vitest";
import { createTokenIssuer, tokenParameters } from "./tokenIssuer.js";
import { readConfig } from "../config.js";

afterEach(() => vi.unstubAllGlobals());

test.each([['auto', []], ['en', ['en-US']], ['ar', ['ar-EG']]] as const)("constrains %s credentials and lifetimes", (language, hints) => {
  const { config } = tokenParameters(language, new AbortController().signal, 0);
  expect(config).toMatchObject({ uses: 1, newSessionExpireTime: new Date(60_000).toISOString(), expireTime: new Date(240_000).toISOString() });
  expect(config!.lockAdditionalFields).toBeUndefined();
  expect(config!.liveConnectConstraints!.config).toEqual({
    responseModalities: ['TEXT'], inputAudioTranscription: { mode: 'VERBATIM', languageCodes: hints },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  });
});

test("installed SDK serializes complete setup locking to the v1beta token endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'auth_tokens/synthetic' }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await createTokenIssuer('synthetic-test-key')('en', new AbortController().signal);
  expect(result.token).toBe('auth_tokens/synthetic');
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
  const body = JSON.parse(options.body as string);
  expect(body.fieldMask).toBeUndefined();
  expect(body.liveConnectConstraints).toBeUndefined();
  expect(body.bidiGenerateContentSetup).toMatchObject({
    model: 'models/gemini-3.5-transcribe-live',
    generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { mode: 'VERBATIM', languageCodes: ['en-US'] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  });
  expect(body.bidiGenerateContentSetup.tools).toBeUndefined();
  expect(body.bidiGenerateContentSetup.sessionResumption).toBeUndefined();
});

test("invalid upstream credentials are rejected", async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  await expect(createTokenIssuer('synthetic')('auto', new AbortController().signal)).rejects.toThrow('INVALID_UPSTREAM_RESPONSE');
});

test("configuration defaults closed and rejects malformed origins and flags", () => {
  expect(readConfig({}).live.enabled).toBe(false);
  expect(() => readConfig({ LIVE_TRANSCRIPTION_ENABLED: 'yes' })).toThrow();
  expect(() => readConfig({ LIVE_ALLOWED_ORIGINS: 'https://example.com/path' })).toThrow();
  expect(() => readConfig({ LIVE_ALLOWED_ORIGINS: '*' })).toThrow();
  expect(() => readConfig({ PORT: '0' })).toThrow();
});

import { afterEach, expect, test, vi } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import type { TokenIssuer } from './tokenIssuer.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const credential = { token: 'auth_tokens/synthetic', model: 'gemini-3.5-transcribe-live', apiVersion: 'v1beta', expiresAt: 'expiry', newSessionExpiresAt: 'expiry' } as const;
async function setup(enabled = true, issuer?: TokenIssuer) {
  const mock = issuer ?? vi.fn().mockResolvedValue(credential);
  const server = createApp({ enabled, allowedOrigins: ['http://localhost:5173'] }, mock).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body = '{"speechLanguage":"auto"}', origin = 'http://localhost:5173') => fetch(`${base}/api/ai/live-token`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
  });
  return { base, post, mock };
}
test('disabled configuration never advertises readiness or issues credentials', async () => {
  const { base, post, mock } = await setup(false);
  expect((await post()).status).toBe(503);
  expect(mock).not.toHaveBeenCalled();
  expect(await (await fetch(`${base}/api/ai/live-config`)).json()).toEqual({ enabled: false, maxTurnSeconds: 120, speechLanguages: ['auto', 'en', 'ar'] });
});
test('enabled configuration advertises readiness without issuing a credential', async () => {
  const { base, mock } = await setup();
  const response = await fetch(`${base}/api/ai/live-config`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ enabled: true, maxTurnSeconds: 120, speechLanguages: ['auto', 'en', 'ar'] });
  expect(mock).not.toHaveBeenCalled();
});
test('an enabled flag without a server credential remains unavailable', async () => {
  const server = createApp({ enabled: true, allowedOrigins: ['http://localhost:5173'] }).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect(await (await fetch(`${base}/api/ai/live-config`)).json()).toEqual({ enabled: false, maxTurnSeconds: 120, speechLanguages: ['auto', 'en', 'ar'] });
  const response = await fetch(`${base}/api/ai/live-token`, { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: '{"speechLanguage":"auto"}' });
  expect(response.status).toBe(503);
});
test('issues only allowlisted requests with no-store responses', async () => {
  const { post, mock } = await setup();
  const response = await post('{"speechLanguage":"ar"}');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(credential);
  expect(mock).toHaveBeenCalledWith('ar', expect.any(AbortSignal));
});
test.each(['{}', '{"speechLanguage":"fr"}', '{"speechLanguage":"auto","model":"other"}', '{', '[]', '"x"'])('rejects invalid payload %s without contacting Google', async (body) => {
  const { post, mock } = await setup();
  const response = await post(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST', retryable: false } });
  expect(mock).not.toHaveBeenCalled();
});
test('rejects absent or untrusted origins', async () => {
  const { post, mock } = await setup();
  expect((await post(undefined, '')).status).toBe(403);
  expect((await post(undefined, 'https://attacker.example')).status).toBe(403);
  expect(mock).not.toHaveBeenCalled();
});
test('failed requests consume the client rate limit', async () => {
  const { post } = await setup();
  for (let index = 0; index < 6; index++) expect((await post('{}')).status).toBe(400);
  const limited = await post();
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
});
test('provider errors never expose provider data', async () => {
  const { post } = await setup(true, async () => { throw new Error('secret provider response'); });
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('secret');
});

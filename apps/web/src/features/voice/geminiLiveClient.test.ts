import { afterEach, expect, test, vi } from 'vitest';
import { openGeminiLiveClient } from './geminiLiveClient';

afterEach(() => vi.useRealTimers());
function setup() {
  const socket = { readyState: 1, bufferedAmount: 0, onopen: null, onclose: null, onerror: null, onmessage: null, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
  const controller = new AbortController();
  const observe = vi.fn(), error = vi.fn(), factory = vi.fn((url: string) => { void url; return socket; });
  const client = openGeminiLiveClient({
    credential: { token: 'auth_tokens/synthetic', apiVersion: 'v1beta', model: 'gemini-3.5-transcribe-live', newSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: new Date(Date.now() + 240_000).toISOString() },
    signal: controller.signal, onObservation: observe, onError: error, socketFactory: factory,
  });
  const receive = async (data: unknown) => {
    socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  return { client, socket, controller, observe, error, factory, receive };
}
test('constrained setup, manual activity and actual audio rate are sent in order', async () => {
  const { client, socket, receive, factory } = setup();
  try {
    socket.onopen?.(new Event('open'));
    expect(() => client.start()).toThrow();
    await receive({ setupComplete: {} }); await client.ready;
    client.start(); client.start();
    client.sendAudio(new ArrayBuffer(9600), 48000);
    client.end(); client.end();
    const sent = vi.mocked(socket.send).mock.calls.map(([value]) => JSON.parse(value as string));
    expect(sent).toHaveLength(4);
    expect(sent[0]).toEqual({ setup: {} });
    expect(sent[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(sent[2].realtimeInput.audio.mimeType).toBe('audio/pcm;rate=48000');
    expect(sent[3]).toEqual({ realtimeInput: { activityEnd: {} } });
    expect(factory.mock.calls[0][0]).toContain('BidiGenerateContentConstrained?access_token=');
  } finally { client.close(); }
});
test('transcripts and model completion remain observations, never a committed result', async () => {
  const { client, receive, observe } = setup();
  try {
    await receive({ setupComplete: {} }); await client.ready;
    await receive({ serverContent: { interimInputTranscription: { text: 'I have' } } });
    await receive({ serverContent: { inputTranscription: { text: 'I have an appointment.', languageCode: 'en-US', finished: true }, turnComplete: true } });
    expect(observe.mock.calls.map(([event]) => event.kind)).toEqual(['interim', 'final', 'model-turn-complete']);
    expect('finish' in client).toBe(false);
  } finally { client.close(); }
});
test('cancel during setup closes immediately and suppresses late events', async () => {
  const { client, controller, socket, receive, observe } = setup();
  controller.abort(); client.close();
  await expect(client.ready).rejects.toMatchObject({ name: 'AbortError' });
  await receive({ serverContent: { inputTranscription: { text: 'late' } } });
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(observe).not.toHaveBeenCalled();
});
test('setup timeout closes resources', async () => {
  vi.useFakeTimers();
  const { client, error, socket } = setup();
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(client.ready).rejects.toThrow('LIVE_SETUP_TIMEOUT');
  expect(error).toHaveBeenCalledWith('LIVE_SETUP_TIMEOUT');
  expect(socket.close).toHaveBeenCalledTimes(1);
});
test('malformed events and congestion fail closed', async () => {
  const first = setup();
  await first.receive({ serverContent: { inputTranscription: { text: 42 } } });
  expect(first.error).toHaveBeenCalledWith('LIVE_INVALID_EVENT');
  const second = setup();
  await second.receive({ setupComplete: {} }); await second.client.ready;
  second.client.start();
  Object.defineProperty(second.socket, 'bufferedAmount', { value: 100_000 });
  expect(() => second.client.sendAudio(new ArrayBuffer(3200), 16000)).toThrow('LIVE_CONNECTION_TOO_SLOW');
  expect(second.socket.close).toHaveBeenCalledTimes(1);
});

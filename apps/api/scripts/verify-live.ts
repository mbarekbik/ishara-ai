/** Explicit operator probe. No microphone, files, transcript logging or UI enablement. */
import { setTimeout as delay } from 'node:timers/promises';
import { createTokenIssuer } from '../src/live/tokenIssuer.js';
import { openGeminiLiveClient } from '../../web/src/features/voice/geminiLiveClient.js';

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.info('BLOCKED: GEMINI_API_KEY is not available in the server process environment. No request sent.');
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let client: ReturnType<typeof openGeminiLiveClient> | undefined;
  const counts = { interim: 0, final: 0, finishedFlags: 0, modelTurnComplete: 0 };
  try {
    const credential = await createTokenIssuer(key)('auto', controller.signal);
    client = openGeminiLiveClient({
      credential, signal: controller.signal,
      onError: (code) => { console.info(code); controller.abort(); },
      onObservation: (event) => {
        if (event.kind === 'model-turn-complete') counts.modelTurnComplete++;
        else { counts[event.kind]++; if (event.finished) counts.finishedFlags++; }
      },
    });
    await client.ready;
    console.info('Credential issuance and constrained v1beta setup acknowledged.');
    client.start();
    for (let index = 0; index < 10; index++) {
      client.sendAudio(new ArrayBuffer(3200), 16000);
      await delay(100, undefined, { signal: controller.signal });
    }
    client.end();
    await delay(10_000, undefined, { signal: controller.signal });
    console.info(JSON.stringify(counts));
    console.info('GATE INCOMPLETE: synthetic silence cannot verify speech completeness, segment semantics, token override rejection, expiry or reuse. Real Voice remains disabled.');
    process.exitCode = 2;
  } catch {
    // Do not print provider errors: they can contain credentials or payloads.
    console.info('BLOCKED: credential or protocol probe failed. Provider details intentionally omitted.');
    process.exitCode = 1;
  } finally { client?.close(); controller.abort(); clearTimeout(timeout); }
}

# Ishara AI

An English/Arabic, browser-first communication prototype for GatewayHacks 2026’s Accessibility & Health track. Sign and Voice share one in-memory conversation. Scope 2 adds real Google Gemini Voice transcription. Scope 3 adds an explicit, context-aware text assistant; Sign recognition, Voice Demo, and the fixed assistant Demo remain available.

## Run locally

Use **Node.js 24 LTS** (recorded in `.node-version`) and its bundled npm 11. Node 22.12+ is also supported by the manifests, but Node 24 is the recommended development and CI runtime.

```sh
cd ishara-ai
npm ci
npm run dev
```

- Web: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3001/api/health>
- Expected health response: `{"status":"ok"}`
- Stop both servers with Ctrl+C. Ports are intentionally fixed; stop another process using them before starting.

If creating a new lockfile with an older npm produces an `edgesOut` resolver error, use Node 24’s npm 11. The committed lockfile makes normal `npm ci` reproducible. No global package installation is needed.

| Command                          | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                    | Web and API together                                               |
| `npm run dev -w @ishara/web`     | Web only; all mock features work without the API                   |
| `npm run dev -w @ishara/api`     | API only                                                           |
| `npm run typecheck`              | Strict TypeScript checks                                           |
| `npm run lint`                   | ESLint, including Hook rules                                       |
| `npm test`                       | Domain, controller, component, camera, localization, and API tests |
| `npm run build`                  | Web static bundle and compiled API                                 |
| `npm run preview -w @ishara/web` | Preview the built web app locally                                  |
| `npm start -w @ishara/api`       | Run the compiled API                                               |

The simulated demo needs no credentials. Real Voice needs the server configuration described in the Scope 2 section below; API startup loads `apps/api/.env` automatically.

## Demo in two minutes

1. Open the landing page and choose **Start Communication**.
2. Choose **Sign Language**.
3. Choose **Use camera-free demo**, or **Enable camera** and approve your browser’s prompt for a local preview.
4. Choose **Start Signing**, then **Stop Signing**. After 800 ms, the first result is “I have an appointment today.” It enters history once.
5. Switch to **Voice / Speech**. The same history stays visible.
6. Explicitly select **Demo — simulated**, then choose **Start Speaking** and **Stop Speaking**. The first result is “Where do you feel pain?” No microphone request occurs.
7. In the assistant panel, explicitly select **Simulated Demo**, then **Ask Ishara AI** for the fixed response “Thank you. Please continue.”
8. Switch to **العربية**. The layout becomes RTL, while previous messages retain their original text and language. New turns use Arabic fixtures.
9. Use **Speaking as** to select either participant independently of input mode.
10. **New conversation** asks before discarding existing messages. Refreshing immediately creates a clean session without a confirmation prompt.

In the demo sequence above, recognition, transcripts, and assistant replies are labeled **Simulated**. Real Voice is separately labelled **Real transcription**. In Demo mode, nothing is inferred from camera images or spoken words. The assistant does not provide medical advice.

## Privacy and camera behavior

- Conversation history exists only in Zustand memory. It is not persisted in browser storage, files, or an API database. Real AI explicitly sends a bounded selection of completed messages through the API to Google; the API processes this context transiently without logging or storing it. Local session IDs and participant labels remain in the browser.
- Only the interface language is stored in `localStorage`, under `ishara.locale.v1`. If storage is unavailable, the language still works in memory.
- The camera requests video only, after an explicit action. It is not recorded, sampled by a model, or uploaded. There are no analytics or external fonts/assets.
- Camera tracks stop when leaving Sign mode, resetting, turning the camera off, choosing the camera-free demo, unmounting, hiding the page, or leaving the page.
- Returning to a hidden page does not reactivate the camera.
- Pending permissions are invalidated on cancellation. A stream that arrives late is immediately stopped.
- Browser-native permission dialogs may block page interaction until dismissed. Deny or dismiss the prompt, then choose the camera-free demo; alternatively choose the demo before requesting access.
- Camera access requires HTTPS or localhost. A phone opening a desktop’s plain HTTP LAN address does not meet the camera requirement. Test phones using a trusted HTTPS deployment; do not bypass certificate warnings.
- Demo Voice uses no microphone. Real Voice sends microphone audio directly to Google for transcription; no browser speech-recognition API is used.

## Architecture and ownership

```text
apps/web/src/
  app/                      Router, shell, styles, adapter composition
  pages/                    Route composition
  components/               Small shared UI primitives
  i18n/                     Typed English/Arabic dictionaries and locale context
  features/communication/   Domain, session store, capture lifecycle, history
  features/sign/            Sign controller, mock adapter, camera hook and preview
  features/voice/           Voice controller, real/mock adapters, PCM capture and Live transport
  features/ai/              Bounded context, real/demo assistant services, revision-aware controller and UI
  mocks/                    Sample phrases, abortable delays and mock operations
  test/                     Test environment setup
apps/api/src/
  app.ts                    Express composition: health, Live credentials and conversation endpoints
  conversation/             Stateless text-generation boundary, validation and access limits
  server.ts                 Process startup and shutdown
```

No shared package exists: the frontend session model stays separate from the small validated conversation request. There are no database, authentication, Python, or avatar dependencies. The existing Google SDK is installed only in the API workspace for constrained token issuance and stateless text generation.

### Session and operation lifecycle

- The URL owns the mode: `/communicate?mode=sign` or `?mode=voice`.
- `/start` selects the mode; `/` is the landing page. Invalid modes redirect to `/start`; unknown paths have a localized not-found page.
- The store owns only the current session. Each completed message records sender, input type, text, original language, creation time, provenance, and optional confidence.
- Interaction state and refs remain local. Services have no store dependency.
- Each operation captures its session and sender and passes its starting language to the adapter. Duplicate starts/stops are guarded synchronously.
- Stop waits for an asynchronously starting adapter if necessary. Cancel aborts work and discards late results, including adapters that ignore abort.
- Mode changes remount the active interaction and assistant controls. Session changes remount the session view. Both cancel pending work; completed messages survive mode changes.
- Navigation home preserves the session until the tab refreshes. Re-entering a session creates fresh demo adapters, so deterministic fixture sequences begin again; existing messages remain.

### Replace the mocks

`app/services.ts` is the composition point. Sign and speech ports expose `begin()` returning `{ finish(), cancel() }`; the assistant port exposes `reply()`.

The camera hook owns the MediaStream. The sign port receives the video element to support future frame observation; only the mock demo accepts a null video source. A future MediaPipe/ML adapter can consume frames between begin and finish without moving media ownership into the store. The Voice port now adds phase, draft and asynchronous error callbacks while retaining finish/cancel operations. Its controller commits the completed turn to the existing store.

`useCaptureInteraction` retains the Sign lifecycle. The dedicated Voice controller manages connection phases and draft text; microphone and transport resources remain outside Zustand. `useAIReply` guards both assistant sources against session and conversation revisions, deadlines and late results.

### Localization and accessibility

Use `useTranslation()` and typed dictionary keys for UI copy. Add a language dictionary and locale registry entry before exposing another locale; no per-component language branches are needed. Darija is intentionally absent pending written-form and terminology decisions.

The shell updates document `lang`/`dir`, uses logical layout properties, and preserves focus on locale changes. Message text uses its own language and `dir="auto"`. Controls use semantic HTML, visible focus, 44px minimum interaction heights, non-color status cues, and reduced-motion styles. Capture status regions announce result text once; history is not a competing live region. There is no forced history scrolling.

## Deployment

`apps/web/dist` is a static SPA. Configure your host to serve `index.html` for `/start`, `/communicate`, and other application paths. Serve over trusted HTTPS for camera use. The API is required for real Voice credentials and Real AI responses. Sign and explicit Demo modes remain functional if the API is down.

The local Vite server proxies `/api` to `127.0.0.1:3001` for development checks. This proxy is not part of the production bundle. Route `/api` through a same-origin reverse proxy when deploying Real Voice. The API currently binds to loopback, appropriate behind a same-host proxy; container/public bindings are a later deployment decision.

GitHub Actions runs clean installation, lint, typecheck, tests, and build on Node 24. No deployment or external publication is configured.

## Verification and remaining manual checks

Automated tests cover shared history, sender independence, reset, deterministic mocks, duplicate actions, delayed startup, abort/late completion, empty/error results, locale parity, mixed-language history, absent microphone calls, camera permission errors, late streams, and device cleanup. The API test uses a real ephemeral HTTP listener.

Browser checks during implementation covered landing/mode navigation, Sign and Voice demo results, the assistant reply, Arabic/RTL, mixed-language history, and a 390px responsive layout. The local in-app browser exposed a pending native camera prompt rather than a usable real preview. Mocked media tests do not replace the following manual acceptance checks:

- [ ] Real camera permission grant, visible live preview, and browser camera-indicator cleanup on desktop Chrome.
- [ ] Permission denial, absent/busy device, and camera-free recovery on a real device.
- [ ] Android Chrome and iOS Safari on trusted HTTPS.
- [ ] Screen-reader listening in English and Arabic, including status announcements and keyboard-only use.
- [ ] Arabic-speaker review of Modern Standard Arabic copy before a public demo.

These manual items must be verified before claiming the full device/accessibility Definition of Done. No real-device or formal accessibility-compliance claim is made by the automated test suite.

## Scope guard

Scopes 2 and 3 add real microphone transcription and explicit communication assistance while preserving the simulated features. MediaPipe, ML inference, signing avatars, Darija, authentication, persistence, clinical recommendations, remote sessions, media uploads, autonomous actions, speech output and distributed infrastructure remain outside this work. No Scope 4 implementation is included.

## Scope 2 — Real Voice transcription

Real Voice uses a browser microphone, Web Audio/AudioWorklet PCM capture, a native Gemini Live WebSocket, and a server-issued constrained ephemeral credential. Interim hypotheses remain in component state. Only completed provider-final text can enter the shared in-memory session. Demo Voice remains an explicit, microphone-free choice. A real failure never returns a sample phrase.

### Server configuration and startup

The working repository is `C:\Users\peaqock\ishara-ai`. Run commands there. The API automatically loads `apps/api/.env` with Node's built-in `loadEnvFile`, using a module-relative path that works in both `src` and compiled `dist`. Values already supplied by the process environment take precedence. A missing file is allowed; other load failures are reported without environment contents. No dotenv dependency is needed.

`apps/api/.env` is ignored by Git. Keep `GEMINI_API_KEY` there or in the server environment only. Never use a `VITE_` credential, commit the file, paste a key into chat, or log its value. The frontend receives only a temporary token. No secret file was copied or returned during implementation.

Nonsecret settings are `LIVE_TRANSCRIPTION_ENABLED=true` to enable real requests, and `LIVE_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173` for the default development origins. Issuance defaults to disabled without the enable flag and a server credential. An explicit origin list replaces the defaults. `.env` changes require restarting the API. Port defaults to `3001`.

In two terminals:

```powershell
cd C:\Users\peaqock\ishara-ai
npm run dev -w @ishara/api
```

```powershell
cd C:\Users\peaqock\ishara-ai
npm run dev -w @ishara/web
```

Or run `npm run dev` to start both. Open `http://127.0.0.1:5173/communicate?mode=voice`, not the API root on port 3001. Vite proxies `/api` to the local API. For compiled API startup, run `npm run build` then `npm start -w @ishara/api`.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | HTTP 200 with `{"status":"ok"}` |
| `GET /api/ai/live-config` | Reports configured availability without creating a credential or claiming provider reachability |
| `POST /api/ai/live-token` | Accepts only `{"speechLanguage":"auto"}` or `en` / `ar`, JSON Content-Type and an exact allowed Origin |

Missing/untrusted origins return 403. Disabled issuance returns 503. Invalid requests return 400; rate limits return 429 and Retry-After. Issuance is limited to six attempts per minute per client and thirty globally. Express stays on loopback and does not trust arbitrary forwarded addresses. Use a network-restricted HTTPS reverse proxy for a supervised demo; origin checks are not user authentication. A direct PowerShell HTTP token request needs an explicit allowed Origin header. The standalone operator probe uses the SDK directly and has no HTTP Origin requirement.

Tokens use `v1beta`, one connection, a 60-second new-session window and a four-minute expiry. The complete setup is locked to `gemini-3.5-transcribe-live`, TEXT output, VERBATIM transcription, selected language hints, and manual activity signals. No tools, output audio, conversation context, or connection resumption are enabled. Long-lived credentials, token URLs, audio and transcripts are never logged by application code.

### Speaking flow and ownership

1. Select **Real transcription**, a participant, and **Auto**, **English**, or **Arabic** as the spoken language. Interface language is independent. Real is preselected when configuration is available; otherwise explicitly choose Demo or correct configuration.
2. Press **Start Speaking** and allow the microphone. Wait for **Speak now**; audio is not buffered during setup.
3. Speak normally. Interim text is visible but is never added to history.
4. Press **Stop Speaking**. Microphone tracks stop immediately; the worklet flushes its partial chunk before activity end is sent. The UI remains in Finalizing while final provider text is collected.
5. One successful turn adds exactly one Voice message with source `service`, captured participant, provider language (or `und` / `mul`) and a stable operation ID.

Each turn stops automatically after 120 seconds. Cancel, mode switch, navigation, New Conversation request (before confirmation), unmount, page hiding/leaving, device loss and provider failure release microphone tracks, nodes, AudioContext, timers and WebSocket resources. Late permission grants are stopped immediately. Duplicate actions and late results cannot commit to another session.

The capture graph produces mono little-endian PCM16 in approximately 100ms chunks. A 16kHz AudioContext is preferred; native-rate fallback uses the actual rate in the audio MIME type. The worklet emits silence to its output, so microphone audio is never played back. No recording files or replay buffer exist. Excessive outbound buffering fails the turn rather than silently dropping audio.

### Finalization policy and limitations

The dedicated service emits provider-final segments and revisable interim hypotheses. Final segments accumulate locally and remain separate from history until Stop. Repeated phrases are retained; content is not deduplicated by text. Assistant/model output is ignored.

After activity end, the current prototype waits for two seconds without a transcription update, with at least one provider-final segment and no unresolved interim text, within an overall ten-second deadline. Each update restarts the settling window. Empty/unresolved output, interruption and timeouts produce an error with no history entry. Interim text is never promoted to final text.

This is an explicit bounded receive-drain policy, **not a provider-guaranteed whole-turn acknowledgement**. `finished` and model `turnComplete` are not assumed to establish such a barrier. Exceptionally delayed final segments beyond the settling window can still be missed; real speech and network-delay regression checks must cover that limitation. Always review the displayed transcript for accuracy. This is a transcription prototype, not a clinical system.

### Exact manual acceptance tests

For each test, start a new speaking turn; do not refresh between turns. Confirm the microphone indicator turns off after Stop and exactly one new message appears.

1. Real, Auto or English: say **Hello, I have an appointment today.** Observe interim text, press Stop, and compare the final text to the spoken sentence.
2. Real, English: say **My stomach has been hurting since yesterday.** Confirm a different real transcript appears, rather than a sample fixture.
3. Keep the interface in English, select spoken language Arabic, and say **لدي موعد اليوم**. Confirm Arabic interim/final content and one additional message.
4. Switch to Sign; check the shared history remains and the camera/demo still works. Return to Voice and confirm Demo is explicitly labelled and requests no microphone.
5. During capture and finalization, test Cancel, mode change, New Conversation (including Keep conversation), navigation and page hiding. Nothing from the cancelled turn may append later.
6. Test denied permission, missing/busy/disconnected microphone, API unavailable and network loss; check localized recovery without silent Demo fallback.
7. Repeat on desktop Chrome, Android Chrome and iOS Safari over trusted HTTPS; check keyboard, focus, 200% zoom, RTL and screen-reader announcements. Localhost is suitable for desktop development; plain HTTP LAN URLs on a phone are not.

### Verification evidence

On September 6, 2026, the user confirmed real microphone permission, interim recognition and exactly one final history message for **Hello, I have an appointment today.** The user also confirmed that **My stomach has been hurting since yesterday.** and **لدي موعد اليوم** (spoken language Arabic) each produced their own matching history message exactly once. These are three real microphone/Gemini acceptance cases, not synthetic-silence or mocked results. Broader language, network-delay and physical-device results remain to be recorded separately.

`npm run typecheck`, `npm run lint`, `npm test` (23 API and 51 web tests) and `npm run build` passed. The browser page was inspected locally with Real selected and the privacy/language controls present. A further headless-browser launch was blocked by an execution policy; the additional automated browser permission-failure sequence was not verified. Real Android/iOS HTTPS and manual screen-reader checks remain outstanding.

Automated checks cover API configuration/env loading without reading the secret file, complete SDK token serialization, origins and limits, WebSocket protocol cancellation, PCM encoding, microphone cleanup/late permission, draft-versus-history separation, exactly-once commits, 120-second stop, explicit Demo, errors and stale results. CI makes no paid Gemini calls and uses no real microphone. Build emits a standalone AudioWorklet asset.

The old `npm run verify:live -w @ishara/api` silence probe is an optional protocol diagnostic only. It is not an acceptance gate and cannot establish speech accuracy/completeness. It reads only a process-supplied credential; the ordinary API startup is the path that loads `.env`.

Scope 2 introduced no transcript/media persistence, translation, reasoning, medical advice, conversational replies, TTS, avatar, sign recognition, authentication or database functionality. Scope 3 extends the assistant separately as described below; its fixed Demo remains an explicit simulation.

## Scope 3 — Context-aware communication assistant

Complete a Sign or Voice turn, choose **Real AI** beside Conversation History, select **Auto**, **English**, or **Arabic** response language, and press **Ask Ishara AI**. This is one explicit, non-streaming request. The successful reply appears once as an AI-generated assistant message. Ask is unavailable again until a new human contribution completes. Demo is an explicit alternative with its original fixed reply; real failures never switch to Demo.

### Configuration and API contracts

The existing module-relative Node `loadEnvFile` startup loads `apps/api/.env`; process environment values take precedence. Scope 3 does not change this loader, read the secret file for verification, or modify the real `.env`. It remains ignored by Git. The existing server-only Google credential is reused internally. No new dependency or frontend SDK was installed.

Add or set these **nonsecret** values yourself in the API environment, then restart the API:

```dotenv
AI_CONVERSATION_ENABLED=true
AI_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

The committed default in `.env.example` is `AI_CONVERSATION_ENABLED=false`. Voice's `LIVE_TRANSCRIPTION_ENABLED` and allowed origins remain independent. Without a configured server credential, Real AI stays unavailable even when the enable flag is true. Do not put credentials in React configuration. Run the API and web with the commands above, or `npm run dev` from `C:\Users\peaqock\ishara-ai`.

| Endpoint | Contract |
| --- | --- |
| `GET /api/ai/conversation-config` | `{enabled,responseLanguages:["auto","en","ar"],limits:{maxMessages:12,maxMessageBytes:8192,maxTextBytes:16384,maxRequestBytes:65536,maxReplyCodePoints:600}}`; no generation or credentials |
| `POST /api/ai/respond` | JSON `{responseLanguage,messages:[{speaker,text,language,source}]}`; success `{reply,language}`; failure `{error:{code,retryable,retryAfterSeconds?}}` |

Only `participant-1`, `participant-2`, and `assistant` are accepted speakers. Source is `mock`, `user`, or `service`; assistant context must be real (`service`). Both outer and message objects reject unknown fields. Message language is a bounded valid language tag, including `und`/`mul`. No session IDs, timestamps, participant labels, confidence, UI locale, media or interim text cross this boundary. Replies use `en` or `ar`.

Exact Origin and JSON Content-Type are required on POST. A PowerShell/operator HTTP request must explicitly provide an allowed Origin; `localhost` and `127.0.0.1` are distinct origins. Missing/unmatched Origin returns `403 AI_FORBIDDEN`. Other failures include 400 invalid input/oversized text, 413 serialized body too large, 422 declined/language required, 429 rate/concurrency limits, 503 unavailable, 502 invalid/upstream response, and 504 timeout. Responses are `Cache-Control: no-store`.

Limits count failed attempts too: 6 requests/minute per IP, 30/minute per API instance, 1 active generation per IP and 2 globally. Excess requests return 429 with `Retry-After` and are never queued. Express continues binding to loopback with proxy trust disabled. These controls are for a network-restricted supervised demo and are not authentication.

### Context, provider and lifecycle

The latest completed message must be human-authored. The frontend walks backward through whole messages, omits fixed Demo assistant replies, stops at 12 messages, 8 KiB per message or 16 KiB combined text, then restores chronological order and removes any leading assistant fragment. It never cuts text to fit. The request itself is capped at 64 KiB. An oversized latest message gets an actionable error. The UI displays selected count and omissions before sharing. The backend independently validates the bounds.

The server pins `gemini-3.8-flash` with the existing `@google/genai` Interactions API, low thinking, a 1,024 output-token ceiling, and `store:false`, `stream:false`, `background:false` on every call. It sends no tools, media, provider conversation IDs or previous-interaction chain. Automatic SDK generation retries are disabled. This follows the current [Google text-generation API](https://ai.google.dev/gemini-api/docs/text-generation) and [structured-output contract](https://ai.google.dev/api/interactions-api-v1).

`ISHARA_CONVERSATION_INSTRUCTION_V1` is server-owned. It treats the JSON conversation envelope as untrusted data, preserves attribution and important facts, and requests one short response, normally under 40 words, with at most one clarification question. It forbids diagnosis, treatment, medication changes and autonomous clinical assessment. Explicit urgent help gets only a short suggestion to contact local emergency services or a nearby person, without inventing a number. Prompt-injection-shaped conversation cannot change the configured system instruction; model behavior still requires evaluation.

Structured provider output is `{outcome:"reply"|"declined"|"language_required",text,language:"en"|"ar"|"und"}`. Only a completed interaction with valid final model-output text, nonempty content, supported language and at most 600 Unicode code points succeeds. Reasoning/tool content is ignored. Errors, incomplete, malformed, declined and language-required outputs cannot enter history. Responses render as plain React text, without HTML or Markdown execution.

Auto follows the latest human message's clear language, consulting the same participant's earlier contributions when needed. Ambiguous/mixed/unsupported language requests an explicit English/Arabic choice. Arabic output is Modern Standard Arabic. The response-language choice is independent of interface and spoken-language choices; existing history is never translated. Demo Auto uses supported message-language metadata and also asks for a language when it cannot choose. Darija is not an acceptance claim.

`useAIReply` captures operation ID, session ID, ordered message IDs/revision, response language and Real/Demo source. It invalidates before committing and the existing store rejects stale session IDs and duplicate message IDs. Any new completed message cancels the pending reply and asks the user to Ask again. Cancel, New Conversation request (before confirmation), mode change, navigation, unmount, page hiding/exit and deadlines abort and invalidate the operation. Dismissing reset confirmation preserves completed history but never resumes cancelled work.

Backend generation has a 20-second deadline; frontend requests and controller operations have a 25-second deadline. Timers/listeners and local capacity are released on settlement or cancellation, including when a test adapter ignores AbortSignal. Aborting the browser does not guarantee that provider computation or billing stops.

### Privacy and manual verification

Real AI shares only the selected completed text and minimal attribution through the API to Google. The application neither persists nor logs the context/reply, performs no analytics, caches no reply, and creates no provider-managed conversation chain. `store:false` disables Interactions retrieval storage; it is not a promise of zero provider operational retention. Review the configured project's [Google service terms](https://ai.google.dev/gemini-api/terms). Use fictional adult demonstration content. Responses can be wrong; this prototype is not for medical advice.

To verify the integrated path:

1. Open `http://127.0.0.1:5173/communicate?mode=voice`. Complete a Real Voice turn and confirm that only the final transcript enters history.
2. Select Real AI and English response language. Ask after “I have an appointment today.” and “My stomach has been hurting since yesterday.” Expect one relevant, short communication response without diagnosis.
3. Complete another human turn, “On the left side.” Ask again; check that the response relates to the earlier statement without beginning a clinical assessment.
4. Try a complicated sentence containing negation, Tuesday/Thursday and 3 p.m.; check simpler wording preserves those facts. A diagnosis/medication request should show a boundary error without adding a reply.
5. Select Arabic while keeping the interface English, then do the reverse. Test Auto with English and Arabic, and unsupported/ambiguous language followed by an explicit language selection.
6. While generating, Cancel, switch modes, request New Conversation (including Keep conversation), navigate home or hide the page. No cancelled reply may append. A new completed human turn during generation must invalidate the old result.
7. With API unavailable, check the accessible error and explicit Demo selection. Demo must never send generation context, microphone or camera data. It remains separately labelled.
8. Check keyboard focus, screen-reader status/errors, narrow viewport, 200% zoom, RTL and mixed-direction history. Recheck real microphone/camera indicators on desktop and Android/iOS over trusted HTTPS.

Scope 3 automated verification passed on September 6, 2026: typecheck, lint, **194 tests (102 API, 92 web)** and production build, including the separate PCM worklet asset. Tests use mocked provider responses and no paid credentials. Scope 1/2 regression tests remain passing, including camera/microphone cleanup, Voice interim/final separation, session preservation and exactly-once results. No Scope 2 capture/transport implementation was changed.

The browser-control tools failed to initialize in this session, so fresh visual, physical-device, screen-reader and microphone-to-AI checks must be distinguished from component tests and direct live HTTP verification. Earlier user-confirmed Scope 2 English/Arabic microphone tests remain recorded above; they do not alone establish the new integrated Scope 3 browser flow.

Live HTTP checks used the running Vite same-origin proxy and the existing API process, without accessing the key. Initial English context and the subsequent "left side" follow-up returned HTTP 200 with short relevant communication responses and no diagnosis. A simplification request also returned a short English response, but changed "unavailable prior to 15:00" to "only after 15:00". The system instruction was strengthened to preserve inclusive/exclusive time boundaries; this refinement still needs a live recheck.

Subsequent diagnosis-boundary and Arabic Auto requests returned Google-origin `429 AI_RATE_LIMITED`, including after waiting; the local API headers still showed unused per-IP/global capacity. No limits were weakened and no alternate model or mock fallback was used. Therefore live Arabic, unsupported-language recovery, injection/clinical boundaries, the tightened simplification instruction and the complete microphone-to-AI browser flow are **not yet accepted**. They require renewed provider capacity and browser testing. Automated language, declined-output, revision/reset, provider-failure and no-fallback cases pass. Generic provider faults remain safely rejected as invalid responses because the provider's general error-code field does not define a reliable safety-specific code; explicit structured declines have their own recoverable error.

### Scope 3 file inventory

All paths below are relative to the only working repository, `C:\Users\peaqock\ishara-ai`.

Created (18 files):

```text
apps/api/src/config.test.ts
apps/api/src/conversation/contract.ts
apps/api/src/conversation/contract.test.ts
apps/api/src/conversation/context.ts
apps/api/src/conversation/context.test.ts
apps/api/src/conversation/systemInstruction.ts
apps/api/src/conversation/geminiConversationService.ts
apps/api/src/conversation/geminiConversationService.test.ts
apps/api/src/conversation/routes.ts
apps/api/src/conversation/routes.test.ts
apps/web/src/features/ai/context.ts
apps/web/src/features/ai/context.test.ts
apps/web/src/features/ai/geminiConversationService.ts
apps/web/src/features/ai/geminiConversationService.test.ts
apps/web/src/features/ai/useAIReply.ts
apps/web/src/features/ai/useAIReply.test.tsx
apps/web/src/features/ai/AIReplyPanel.tsx
apps/web/src/features/ai/AIReplyPanel.test.tsx
```

Modified (16 files):

```text
README.md
apps/api/.env.example
apps/api/src/config.ts
apps/api/src/app.ts
apps/api/src/app.test.ts
apps/api/src/server.ts
apps/web/src/app/services.ts
apps/web/src/app/styles.css
apps/web/src/features/ai/service.ts
apps/web/src/features/ai/mockAIService.ts
apps/web/src/features/communication/ConversationHistory.tsx
apps/web/src/features/communication/MessageItem.tsx
apps/web/src/features/communication/CommunicationFlow.test.tsx
apps/web/src/pages/CommunicationPage.tsx
apps/web/src/i18n/en.ts
apps/web/src/i18n/ar.ts
```

Removed/replaced (2 files): `apps/web/src/features/ai/useDemoReply.ts` became `useAIReply.ts`; `apps/web/src/features/ai/DemoReplyButton.tsx` became `AIReplyPanel.tsx`. These are feature evolutions, with no unused compatibility wrappers. Manifests, lockfile, `.gitignore`, real `.env`, session store/domain, router, Sign/camera and Voice/Live implementation files are unchanged. Existing Git history is preserved; no commit was created.

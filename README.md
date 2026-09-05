# Ishara AI

An English/Arabic, browser-first communication prototype for GatewayHacks 2026’s Accessibility & Health track. Sign and Voice share one in-memory conversation. This is Scope 1: the application foundation, not working sign or speech recognition.

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

No credentials or environment variables are required. The API accepts an optional `PORT` process environment variable, defaulting to `3001`. `apps/api/.env.example` documents that variable; `.env` files are not automatically loaded. For example, in PowerShell use `$env:PORT = '3001'` before starting the API.

## Demo in two minutes

1. Open the landing page and choose **Start Communication**.
2. Choose **Sign Language**.
3. Choose **Use camera-free demo**, or **Enable camera** and approve your browser’s prompt for a local preview.
4. Choose **Start Signing**, then **Stop Signing**. After 800 ms, the first result is “I have an appointment today.” It enters history once.
5. Switch to **Voice / Speech**. The same history stays visible.
6. Choose **Start Speaking**, then **Stop Speaking**. The first result is “Where do you feel pain?” No microphone request occurs.
7. Optionally choose **Show demo assistant reply** for the fixed response “Thank you. Please continue.”
8. Switch to **العربية**. The layout becomes RTL, while previous messages retain their original text and language. New turns use Arabic fixtures.
9. Use **Speaking as** to select either participant independently of input mode.
10. **New conversation** asks before discarding existing messages. Refreshing immediately creates a clean session without a confirmation prompt.

All recognition, transcripts, and assistant replies are explicitly labeled **Simulated**. Nothing is inferred from camera images or spoken words. The assistant does not provide medical advice.

## Privacy and camera behavior

- Messages and participant data exist only in Zustand memory. They are not stored in localStorage, sessionStorage, IndexedDB, files, or the API.
- Only the interface language is stored in `localStorage`, under `ishara.locale.v1`. If storage is unavailable, the language still works in memory.
- The camera requests video only, after an explicit action. It is not recorded, sampled by a model, or uploaded. There are no analytics or external fonts/assets.
- Camera tracks stop when leaving Sign mode, resetting, turning the camera off, choosing the camera-free demo, unmounting, hiding the page, or leaving the page.
- Returning to a hidden page does not reactivate the camera.
- Pending permissions are invalidated on cancellation. A stream that arrives late is immediately stopped.
- Browser-native permission dialogs may block page interaction until dismissed. Deny or dismiss the prompt, then choose the camera-free demo; alternatively choose the demo before requesting access.
- Camera access requires HTTPS or localhost. A phone opening a desktop’s plain HTTP LAN address does not meet the camera requirement. Test phones using a trusted HTTPS deployment; do not bypass certificate warnings.
- Voice mode has **no microphone or browser speech-recognition implementation**.

## Architecture and ownership

```text
apps/web/src/
  app/                      Router, shell, styles, adapter composition
  pages/                    Route composition
  components/               Small shared UI primitives
  i18n/                     Typed English/Arabic dictionaries and locale context
  features/communication/   Domain, session store, capture lifecycle, history
  features/sign/            Sign controller, mock adapter, camera hook and preview
  features/voice/           Voice controller and mock adapter
  features/ai/              Explicit fixed assistant demo
  mocks/                    Sample phrases, abortable delays and mock operations
  test/                     Test environment setup
apps/api/src/
  app.ts                    Express application and GET /api/health
  server.ts                 Process startup and shutdown
```

No shared package exists because the API does not consume the communication model. Extract genuine common contracts when it does. There are no database, authentication, Python, avatar, or integration SDK dependencies.

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

The camera hook owns the MediaStream. The sign port receives the video element to support future frame observation; only the mock demo accepts a null video source. A future MediaPipe/ML adapter can consume frames between begin and finish without moving media ownership into the store. Real streaming speech will need additional connection/partial-result events in Scope 2; the finite-turn API deliberately does not pretend to implement a realtime transport today.

`useCaptureInteraction` centralizes lifecycle guarantees shared by three actual callers. The mode hooks remain small domain-specific adapters, not a general DI framework.

### Localization and accessibility

Use `useTranslation()` and typed dictionary keys for UI copy. Add a language dictionary and locale registry entry before exposing another locale; no per-component language branches are needed. Darija is intentionally absent pending written-form and terminology decisions.

The shell updates document `lang`/`dir`, uses logical layout properties, and preserves focus on locale changes. Message text uses its own language and `dir="auto"`. Controls use semantic HTML, visible focus, 44px minimum interaction heights, non-color status cues, and reduced-motion styles. Capture status regions announce result text once; history is not a competing live region. There is no forced history scrolling.

## Deployment

`apps/web/dist` is a static SPA. Configure your host to serve `index.html` for `/start`, `/communicate`, and other application paths. Serve over trusted HTTPS for camera use. The API is independent; the web prototype makes no API calls and remains functional if the API is down.

The local Vite server proxies `/api` to `127.0.0.1:3001` for development checks. This proxy is not part of the production bundle. Put the API behind your host’s reverse proxy when a real frontend API consumer is introduced. The API currently binds to loopback, appropriate behind a same-host proxy; container/public bindings are a later deployment decision.

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

Do not add real Gemini, microphone capture, MediaPipe, ML inference, a signing avatar, Darija, authentication, persistence, clinical recommendations, remote sessions, media uploads, or distributed infrastructure as part of this scope. Scope 2 starts with the real voice/security connection design, not by placing a long-lived API key in the frontend.

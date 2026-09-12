import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { LandmarkFrame } from "./extractionModel.ts";
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT } from "./sourceFiles.ts";

type Delegate = "GPU" | "CPU";
type JsonObject = Record<string, unknown>;
export interface ExtractionBrowser {
  browserVersion: string;
  runtimeInfo: Record<string, unknown>;
  startSample(runId: string, delegate?: Delegate): Promise<Delegate>;
  infer(rgba: Buffer, width: number, height: number, timestampMs: number, sequence: number, runId: string): Promise<LandmarkFrame>;
  endSample(): Promise<void>;
  close(): Promise<void>;
}

const DERIVED_ROOT = resolve(REPOSITORY_ROOT, "data/scope5/derived/mosl-v1/smoke5-v1/landmarks-v1");
const TRACKING_ROOT = resolve(REPOSITORY_ROOT, "apps/web/src/features/sign/tracking");
const BROWSER_ROOT = resolve(REPOSITORY_ROOT, "tools/sign-data/browser");
const PUBLIC_ROOT = resolve(REPOSITORY_ROOT, "apps/web/public");

/** Small private CDP client. Arguments/results never enter console or disk logs. */
class Protocol {
  private id = 0;
  private pending = new Map<number, { resolve: (value: JsonObject) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private socket: WebSocket;
  constructor(url: string) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1") throw new Error("Unexpected browser debugging endpoint");
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", event => {
      if (typeof event.data !== "string") { this.fail(); return; }
      let response: { id?: number; error?: unknown; result?: JsonObject };
      try { response = JSON.parse(event.data) as typeof response; } catch { this.fail(); return; }
      if (response.id === undefined) return;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id); clearTimeout(request.timer);
      if (response.error) request.reject(new Error("Browser protocol rejected the request"));
      else request.resolve(response.result ?? {});
    });
    this.socket.addEventListener("close", () => this.fail());
    this.socket.addEventListener("error", () => this.fail());
  }
  async ready(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Browser protocol connection timed out")); }, 10_000);
      const open = () => { cleanup(); resolveReady(); };
      const fail = () => { cleanup(); reject(new Error("Browser protocol connection failed")); };
      const cleanup = () => { clearTimeout(timer); this.socket.removeEventListener("open", open); this.socket.removeEventListener("error", fail); this.socket.removeEventListener("close", fail); };
      this.socket.addEventListener("open", open, { once: true });
      this.socket.addEventListener("error", fail, { once: true });
      this.socket.addEventListener("close", fail, { once: true });
    });
  }
  send(method: string, params: JsonObject = {}, timeoutMs = 45_000): Promise<JsonObject> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Browser protocol is disconnected"));
    return new Promise((resolveRequest, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser operation timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error("Browser protocol send failed")); }
    });
  }
  private fail() {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Browser protocol disconnected")); }
    this.pending.clear();
  }
  close() { this.fail(); this.socket.close(); }
}

function resultValue(response: JsonObject): unknown {
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails as { exception?: { description?: string } };
    const code = detail.exception?.description?.match(/tracking[A-Z][A-Za-z]+/u)?.[0];
    throw new Error(`Offline browser operation failed${code ? `: ${code}` : ""}`);
  }
  return (response.result as { value?: unknown } | undefined)?.value;
}

async function installedBrowser(): Promise<string> {
  // Use an installed desktop Chromium only. No downloads or user browser profile.
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ } }
  throw new Error("An installed desktop Chrome or Edge executable is required");
}

async function debuggingAddress(profile: string, process: ChildProcess): Promise<string> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error("Installed browser exited before startup");
    try {
      const text = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      const port = text.split(/\r?\n/u)[0];
      if (/^\d{1,5}$/u.test(port) && Number(port) > 0 && Number(port) < 65536) return `http://127.0.0.1:${port}`;
    } catch { /* The private browser profile has not published its port yet. */ }
    await delay(150);
  }
  throw new Error("Installed browser did not publish its debugging port");
}

async function allowedBuildFiles(root: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = boundedPath(root, relative(root, join(directory, item.name)));
      await assertNoLinks(root, path);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) entries.set(`/${relative(root, path).replaceAll("\\", "/")}`, path);
    }
  }
  await visit(root);
  return entries;
}

async function startAssetServer(allowed: Map<string, string>, workerPolicy: string): Promise<{ server: Server; origin: string }> {
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".wasm": "application/wasm", ".task": "application/octet-stream" };
  let origin = "";
  const server = createServer((request, response) => {
    // Exact path allowlist: no source videos, manifest files, repository listing,
    // Vite dev server or arbitrary filesystem URL is reachable from this server.
    if (request.headers.host !== origin.slice("http://".length) || !["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(403); response.end(); return; }
    const path = request.url ?? "";
    const file = allowed.get(path);
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    response.setHeader("Content-Security-Policy", file.endsWith(".html")
      ? "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'"
      : workerPolicy);
    if (request.method === "HEAD") { response.writeHead(200); response.end(); return; }
    const stream = createReadStream(file);
    stream.on("error", () => { if (!response.headersSent) response.writeHead(500); response.end(); });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise<void>((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolveReady(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid offline server address");
  origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}

export async function createExtractionBrowser(): Promise<ExtractionBrowser> {
  await assertNoLinks(REPOSITORY_ROOT, DERIVED_ROOT);
  await mkdir(DERIVED_ROOT, { recursive: true });
  const runtimeRoot = await mkdtemp(join(DERIVED_ROOT, ".runtime-"));
  let child: ChildProcess | undefined;
  let server: Server | undefined;
  let protocol: Protocol | undefined;
  let objectId: string | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  async function call(method: string, args: unknown[], timeoutMs?: number): Promise<unknown> {
    if (closed || !protocol || !objectId) throw new Error("Offline browser is not active");
    return resultValue(await protocol.send("Runtime.callFunctionOn", {
      objectId, functionDeclaration: "function(method, args) { return this[method](...args); }",
      arguments: [{ value: method }, { value: args }], awaitPromise: true, returnByValue: true,
      objectGroup: "ishara-offline-extraction",
    }, timeoutMs));
  }
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (protocol && objectId && !closed) { try { await call("endSample", [], 2_000); } catch { /* Browser termination also releases the worker. */ } }
      closed = true;
      if (protocol) { try { await protocol.send("Browser.close", {}, 2_000); } catch { /* Closing the browser may end CDP before its acknowledgement. */ } protocol.close(); }
      if (child && child.exitCode === null) {
        await Promise.race([new Promise<void>(resolveExit => child!.once("exit", () => resolveExit())), delay(3_000)]);
        if (child.exitCode === null) child.kill();
      }
      if (server) { server.closeAllConnections(); await new Promise<void>(resolveClose => server!.close(() => resolveClose())); }
      // Delete only the exact mkdtemp directory this invocation owns. Never remove
      // the derived dataset, another run's profile, or any source directory.
      if (dirname(runtimeRoot) !== DERIVED_ROOT || !/^\.runtime-[A-Za-z0-9]+$/u.test(basename(runtimeRoot))) throw new Error("Unsafe browser cleanup target");
      await assertNoLinks(REPOSITORY_ROOT, runtimeRoot);
      await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    })();
    return closePromise;
  }
  try {
    const buildRoot = boundedPath(runtimeRoot, "build");
    const profile = boundedPath(runtimeRoot, "profile");
    const policySource = await readFile(join(TRACKING_ROOT, "runtimeAssets.ts"), "utf8");
    const declaration = policySource.match(/export const TRACKING_WORKER_POLICY = ("[^"\r\n]+");/u)?.[1];
    if (!declaration) throw new Error("Cannot read the production tracking worker policy");
    const workerPolicy = JSON.parse(declaration) as string;
    const assetManifest = JSON.parse(await readFile(resolve(REPOSITORY_ROOT, "apps/web/vision-assets.json"), "utf8")) as {
      packageVersion: string; wasmPath: string; model: { path: string; bytes: number; sha256: string };
    };
    const packageRoot = dirname(fileURLToPath(import.meta.resolve("@mediapipe/tasks-vision")));
    const installedPackage = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version?: string };
    if (installedPackage.version !== assetManifest.packageVersion) throw new Error("Installed MediaPipe package differs from the production asset manifest");
    const files = [assetManifest.model.path, `${assetManifest.wasmPath}/vision_wasm_module_internal.js`, `${assetManifest.wasmPath}/vision_wasm_module_internal.wasm`];
    const assetHashes: Record<string, string> = {};
    for (const name of files) {
      const path = boundedPath(PUBLIC_ROOT, name);
      await assertNoLinks(REPOSITORY_ROOT, path);
      const digest = await hashFile(path);
      if (name === assetManifest.model.path && (digest.sha256 !== assetManifest.model.sha256 || digest.size !== assetManifest.model.bytes)) throw new Error("Production Holistic model integrity mismatch");
      if (name !== assetManifest.model.path) {
        const packagedWasm = join(packageRoot, "wasm", basename(path));
        await assertNoLinks(REPOSITORY_ROOT, packagedWasm);
        if ((await hashFile(packagedWasm)).sha256 !== digest.sha256) throw new Error("Prepared WASM differs from the installed pinned MediaPipe package");
      }
      assetHashes[name] = digest.sha256;
    }
    await build({
      configFile: false, envFile: false, root: BROWSER_ROOT, publicDir: false, base: "/", logLevel: "silent",
      worker: { format: "es" },
      build: { outDir: buildRoot, emptyOutDir: false, sourcemap: false, target: "es2022", rollupOptions: { input: join(BROWSER_ROOT, "extraction.html") } },
    });
    const allowed = await allowedBuildFiles(buildRoot);
    for (const name of files) allowed.set(`/${name}`, boundedPath(PUBLIC_ROOT, name));
    const started = await startAssetServer(allowed, workerPolicy);
    server = started.server;
    await mkdir(profile);
    const executable = await installedBrowser();
    child = spawn(executable, [
      "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
      "--disable-sync", "--disable-default-apps", "--disable-extensions", "--disable-breakpad", "--disable-crash-reporter",
      "--no-pings", "--noerrdialogs", "--password-store=basic", "--use-mock-keychain", "--metrics-recording-only",
      "--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication,Translate",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank",
    ], { windowsHide: true, stdio: "ignore" });
    child.on("error", () => { /* Startup polling reports a sanitized failure. */ });
    const debugging = await debuggingAddress(profile, child);
    const response = await fetch(`${debugging}/json/list`, { signal: AbortSignal.timeout(5_000) });
    const targets = await response.json() as { type?: string; webSocketDebuggerUrl?: string }[];
    const endpoint = targets.find(target => target.type === "page")?.webSocketDebuggerUrl;
    if (!response.ok || !endpoint) throw new Error("Installed browser has no private page target");
    protocol = new Protocol(endpoint);
    await protocol.ready();
    const version = await protocol.send("Browser.getVersion");
    await protocol.send("Page.enable");
    await protocol.send("Page.navigate", { url: `${started.origin}/extraction.html` });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const check = await protocol.send("Runtime.evaluate", { expression: "globalThis.isharaOfflineExtraction", objectGroup: "ishara-offline-extraction" });
      const remote = check.result as { objectId?: string; type?: string } | undefined;
      if (remote?.objectId && remote.type === "object") { objectId = remote.objectId; break; }
      await delay(100);
    }
    if (!objectId) throw new Error("Offline extraction entry did not load");
    const policy = resultValue(await protocol.send("Runtime.evaluate", { expression: "globalThis.isharaOfflineExtraction.policy", returnByValue: true }));
    if (policy !== workerPolicy) throw new Error("Browser worker policy differs from the production policy");
    const workerEntries = [...allowed.keys()].filter(path => path.includes("landmarkTracking.worker") && path.endsWith(".js"));
    if (workerEntries.length !== 1) throw new Error("Expected one bundled production landmark worker");
    const workerResponse = await fetch(`${started.origin}${workerEntries[0]}`, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
    if (workerResponse.headers.get("Content-Security-Policy") !== workerPolicy) throw new Error("Offline worker response lacks production privacy enforcement");
    const sourceHashes: Record<string, string> = {};
    for (const name of ["landmarkTracking.worker.ts", "workerClient.ts", "mediapipeHolisticAdapter.ts", "model.ts", "runtimeAssets.ts"]) sourceHashes[name] = (await hashFile(join(TRACKING_ROOT, name))).sha256;
    const graphics = resultValue(await protocol.send("Runtime.evaluate", { expression: "(() => { const canvas = new OffscreenCanvas(1,1); const gl = canvas.getContext('webgl2'); if (!gl) return {webgl2:false}; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return {webgl2:true, vendor:ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer:ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}; })()", returnByValue: true }));
    return {
      browserVersion: String(version.product),
      runtimeInfo: {
        browserProduct: version.product, browserRevision: version.revision, browserUserAgent: version.userAgent,
        javascriptVersion: version.jsVersion, nodeVersion: process.version, headless: true, graphics,
        packageVersion: assetManifest.packageVersion, modelIdentity: assetManifest.model.path,
        modelSHA256: assetManifest.model.sha256, assetSHA256: assetHashes, scope4SourceSHA256: sourceHashes,
        workerContentSecurityPolicy: workerPolicy, workerPolicyHeaderVerified: true,
        workerStrategy: "unchanged-scope4-worker-per-recording", detectorStrategy: "first-recording-production-fallback-then-fixed-delegate",
        maxImageLongEdge: 960, resizeQuality: "low", inferenceTimeoutMs: 30_000, initializationTimeoutMsPerAttempt: 30_000,
      },
      async startSample(id, delegate) {
        const actual = await call("startSample", delegate ? [id, delegate] : [id], 75_000);
        if ((actual !== "GPU" && actual !== "CPU") || (delegate && delegate !== actual)) throw new Error("Unexpected or inconsistent MediaPipe delegate");
        return actual;
      },
      async infer(rgba, width, height, timestampMs, sequence, id) {
        if (rgba.byteLength !== width * height * 4) throw new Error("RGBA frame length does not match geometry");
        return await call("infer", [rgba.toString("base64"), width, height, timestampMs, sequence, id]) as LandmarkFrame;
      },
      async endSample() { await call("endSample", [], 2_000); },
      close,
    };
  } catch (error) {
    try { await close(); } catch { throw new Error("Offline browser failed and its private runtime cleanup requires review"); }
    throw error;
  }
}

import express, { type ErrorRequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { LiveConfig } from "../config.js";
import { createTokenIssuer, type TokenIssuer } from "./tokenIssuer.js";

function fail(response: Response, status: number, code: string, retryable = false) {
  response.status(status).json({ error: { code, retryable } });
}

export function liveRoutes(config: LiveConfig, injectedIssuer?: TokenIssuer) {
  const router = express.Router();
  const issuer = injectedIssuer ?? (config.apiKey ? createTokenIssuer(config.apiKey) : undefined);
  const available = config.enabled && Boolean(issuer);
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.get("/live-config", (_request, response) => {
    // Configured availability is not a guarantee of provider connectivity.
    response.json({ enabled: available, maxTurnSeconds: 120, speechLanguages: ["auto", "en", "ar"] });
  });
  const handler = (_request: express.Request, response: Response) => fail(response, 429, "LIVE_RATE_LIMITED", true);
  const globalLimit = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: () => "supervised-instance", standardHeaders: "draft-8", legacyHeaders: false, handler });
  const clientLimit = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false, handler });
  router.post("/live-token", globalLimit, clientLimit, (request, response, next) => {
    if (!config.allowedOrigins.includes(request.get("origin") ?? "")) {
      fail(response, 403, "LIVE_FORBIDDEN"); return;
    }
    if (!available) { fail(response, 503, "LIVE_UNAVAILABLE", true); return; }
    if (!request.is("application/json")) { fail(response, 400, "INVALID_REQUEST"); return; }
    next();
  }, express.json({ limit: "1kb", strict: true }), async (request, response) => {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !("speechLanguage" in body) ||
        (body.speechLanguage !== "auto" && body.speechLanguage !== "en" && body.speechLanguage !== "ar")) {
      fail(response, 400, "INVALID_REQUEST"); return;
    }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once("close", disconnect);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("DEADLINE")); }, 10_000);
      });
      const credential = await Promise.race([issuer!(body.speechLanguage, controller.signal), deadline]);
      if (!controller.signal.aborted && !response.destroyed) response.json(credential);
    } catch {
      if (!response.destroyed) fail(response, controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? "LIVE_TIMEOUT" : "LIVE_UPSTREAM_ERROR", true);
    } finally {
      clearTimeout(timer);
      response.off("close", disconnect);
      controller.abort();
    }
  });
  const malformed: ErrorRequestHandler = (_error, _request, response, _next) => {
    void _error; void _next;
    fail(response, 400, "INVALID_REQUEST");
  };
  router.use(malformed);
  return router;
}

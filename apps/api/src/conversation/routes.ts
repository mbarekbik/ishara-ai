import express, { type ErrorRequestHandler, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { ConversationConfig } from "../config.js";
import { CONVERSATION_LIMITS, ConversationError, isRecord, validateConversationRequest, type ConversationService } from "./contract.js";
import { createGeminiConversationService, normalizeProviderError } from "./geminiConversationService.js";

function fail(response: Response, error: ConversationError, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) response.set("Retry-After", String(retryAfterSeconds));
  response.status(error.status).json({ error: {
    code: error.code, retryable: error.retryable,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  } });
}

export function conversationRoutes(config: ConversationConfig, injectedService?: ConversationService,
  timing: { deadlineMs?: number } = {}) {
  const router = express.Router();
  const service = injectedService ?? (config.apiKey ? createGeminiConversationService(config.apiKey) : undefined);
  const enabled = config.enabled && Boolean(service);
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.get("/conversation-config", (_request, response) => {
    response.json({ enabled, responseLanguages: ["auto", "en", "ar"], limits: CONVERSATION_LIMITS });
  });
  const limited = (_request: express.Request, response: Response) => {
    const retry = Math.max(1, Number(response.get("Retry-After")) || 60);
    fail(response, new ConversationError("AI_RATE_LIMITED", 429, true), retry);
  };
  const globalLimit = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: () => "supervised-conversation-instance",
    standardHeaders: "draft-8", legacyHeaders: false, handler: limited });
  const clientLimit = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false, handler: limited });
  let activeCount = 0;
  const activeClients = new Set<string>();
  router.post("/respond", globalLimit, clientLimit, (request, response, next) => {
    if (!config.allowedOrigins.includes(request.get("origin") ?? "")) {
      fail(response, new ConversationError("AI_FORBIDDEN", 403)); return;
    }
    if (!enabled) { fail(response, new ConversationError("AI_UNAVAILABLE", 503, true)); return; }
    if (!request.is("application/json")) { fail(response, new ConversationError("AI_INVALID_REQUEST", 400)); return; }
    next();
  }, express.json({ limit: CONVERSATION_LIMITS.maxRequestBytes, strict: true, inflate: false }), async (request, response) => {
    let input;
    try { input = validateConversationRequest(request.body); }
    catch (error) { fail(response, error instanceof ConversationError ? error : new ConversationError("AI_INVALID_REQUEST", 400)); return; }
    const client = ipKeyGenerator(request.ip ?? "unknown");
    if (activeClients.has(client) || activeCount >= 2) {
      fail(response, new ConversationError("AI_RATE_LIMITED", 429, true), 1); return;
    }
    activeClients.add(client);
    activeCount++;
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disconnected!: () => void;
    const disconnect = new Promise<never>((_resolve, reject) => {
      disconnected = () => { controller.abort(); reject(new DOMException("Cancelled", "AbortError")); };
    });
    response.once("close", disconnected);
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ConversationError("AI_TIMEOUT", 504, true));
        }, timing.deadlineMs ?? 20_000);
      });
      const result = await Promise.race([service!(input, controller.signal), deadline, disconnect]);
      if (!controller.signal.aborted && !response.destroyed) response.json(result);
    } catch (error) {
      if (!response.destroyed) {
        const normalized = timedOut ? new ConversationError("AI_TIMEOUT", 504, true) : normalizeProviderError(error);
        fail(response, normalized, normalized.status === 429 ? 60 : undefined);
      }
    } finally {
      clearTimeout(timer);
      response.off("close", disconnected);
      controller.abort();
      activeCount--;
      activeClients.delete(client);
    }
  });
  const malformed: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    void _next;
    const oversized = isRecord(error) && error.type === "entity.too.large";
    fail(response, new ConversationError(oversized ? "AI_MESSAGE_TOO_LARGE" : "AI_INVALID_REQUEST", oversized ? 413 : 400));
  };
  router.use(malformed);
  return router;
}

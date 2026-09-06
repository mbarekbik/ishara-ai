import express from "express";
import type { ConversationConfig, LiveConfig } from "./config.js";
import { liveRoutes } from "./live/routes.js";
import type { TokenIssuer } from "./live/tokenIssuer.js";
import { conversationRoutes } from "./conversation/routes.js";
import type { ConversationService } from "./conversation/contract.js";
export function createApp(config: LiveConfig = { enabled: false, allowedOrigins: [] }, issuer?: TokenIssuer,
  conversation: ConversationConfig = { enabled: false, allowedOrigins: [] }, service?: ConversationService) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.use("/api/ai", liveRoutes(config, issuer));
  app.use("/api/ai", conversationRoutes(conversation, service));
  return app;
}
export const app = createApp();

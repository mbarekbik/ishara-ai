import express from "express";
import type { LiveConfig } from "./config.js";
import { liveRoutes } from "./live/routes.js";
import type { TokenIssuer } from "./live/tokenIssuer.js";
export function createApp(config: LiveConfig = { enabled: false, allowedOrigins: [] }, issuer?: TokenIssuer) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.use("/api/ai", liveRoutes(config, issuer));
  return app;
}
export const app = createApp();

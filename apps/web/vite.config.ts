import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin, ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { TRACKING_WORKER_POLICY } from "./src/features/sign/tracking/runtimeAssets";

// Workers have their own policy. Applying this to the page would block Gemini Live.

function trackingWorkerHeaders(): Plugin {
  const install = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const developmentWorker = pathname.endsWith(
        "/src/features/sign/tracking/landmarkTracking.worker.ts",
      );
      const productionWorker = /\/assets\/vision\/landmarkTracking\.worker-[\w-]+\.js$/.test(pathname);
      if (developmentWorker || productionWorker) {
        response.setHeader("Content-Security-Policy", TRACKING_WORKER_POLICY);
      }
      next();
    });
  };
  return {
    name: "ishara-tracking-worker-headers",
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), trackingWorkerHeaders()],
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/vision/[name]-[hash].js",
        chunkFileNames: "assets/vision/[name]-[hash].js",
      },
    },
  },
  build: mode === "vision-check" ? {
    outDir: ".vision-check",
    rollupOptions: {
      input: fileURLToPath(new URL("./verification/vision.html", import.meta.url)),
    },
  } : undefined,
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  test: {
    // Concurrent jsdom startup caused CPU contention and flow-test timeouts.
    fileParallelism: false,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
}));

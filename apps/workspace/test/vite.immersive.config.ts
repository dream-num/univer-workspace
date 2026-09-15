import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { htmlViewRuntime } from "@univerjs-labs/html-view-renderer/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react(), tailwindcss(), htmlViewRuntime(), {
    name: "immersive-fixture-routes",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // No backend: prevent background SSE reconnects in the actual application shell.
        if (request.url?.startsWith("/api/")) { response.statusCode = 204; response.end(); return; }
        if (request.url?.startsWith("/nodes/")) request.url = "/test/fixtures/immersive.html";
        next();
      });
    },
  }],
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
});

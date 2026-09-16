import { defineConfig } from "vite";
import { htmlViewRuntime } from "@univerjs-labs/html-view-renderer/vite";

export default defineConfig({
  plugins: [htmlViewRuntime()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
});

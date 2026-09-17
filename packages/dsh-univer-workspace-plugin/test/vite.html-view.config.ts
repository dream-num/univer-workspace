import { defineConfig } from "vite";

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
});

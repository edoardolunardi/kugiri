import { defineConfig } from "vite";

// Serves the demo page; the library itself is built by tsc from src/.
export default defineConfig({
  root: "demo",
  publicDir: false,
  server: {
    port: 4173,
    strictPort: true,
  },
});

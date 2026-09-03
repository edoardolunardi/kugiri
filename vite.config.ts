import { defineConfig } from "vite";

// Serves and builds the demo page; the library itself is built by tsc from src/.
export default defineConfig({
  root: "demo",
  publicDir: false,
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
  server: {
    port: 4173,
    strictPort: true,
  },
});

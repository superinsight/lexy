import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  server: {
    port: 5174,
  },
  build: {
    outDir: "dist",
  },
});

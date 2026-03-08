import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", ["LEXY_PROXY_"]);
  const proxyTarget = env.LEXY_PROXY_BASE_URL || "http://localhost:4000";

  return {
    appType: "spa",
    envDir: "..",
    envPrefix: ["VITE_", "LEXY_PROXY_"],
    server: {
      port: 5174,
      proxy: {
        "/lexy-proxy": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/lexy-proxy/, ""),
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});

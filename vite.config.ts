import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Development uses worker/dev/ai.ts, so nothing needs a remote session.
    cloudflare({ inspectorPort: 0, remoteBindings: false }),
  ],
  resolve: { tsconfigPaths: true },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});

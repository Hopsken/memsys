import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ inspectorPort: 0 })],
  resolve: { tsconfigPaths: true },
  server: {
    allowedHosts: process.env.PUBLIC_URL
      ? [new URL(process.env.PUBLIC_URL).hostname]
      : [],
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});

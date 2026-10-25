import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      inspectorPort: 0,
      remoteBindings: true,
    }),
  ],
  resolve: { tsconfigPaths: true },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});

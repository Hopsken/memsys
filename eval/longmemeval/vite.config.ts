import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The dev server the LongMemEval harness talks to: the Worker only. Without
// remote bindings it runs without Cloudflare credentials; the relevance
// filter (Jev) needs Workers AI, so start it with JEV=1 (and CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID) for runs that turn the filter on.
export default defineConfig({
  plugins: [
    cloudflare({
      inspectorPort: 0,
      remoteBindings: process.env["JEV"] === "1",
    }),
  ],
  resolve: { tsconfigPaths: true },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});

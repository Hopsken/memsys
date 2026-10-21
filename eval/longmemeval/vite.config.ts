import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The dev server the LongMemEval harness talks to: the Worker only, without
// remote bindings, so it runs without Cloudflare credentials. Jev, the only
// user of Workers AI, is off by default and stays off here.
export default defineConfig({
  plugins: [cloudflare({ inspectorPort: 0, remoteBindings: false })],
  resolve: { tsconfigPaths: true },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});

import { env } from "cloudflare:workers";
import { z } from "zod";

import { jev } from "./jev";

// Jev on this Worker's Workers AI binding: recall's relevance judge. Kept
// apart from jev.ts so tests can run Jev against a fake without workerd.
export const relevanceJudge = jev({
  run: async (model, input) => z.json().parse(await env.AI.run(model, input)),
});

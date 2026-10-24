import { env } from "cloudflare:workers";
import { z } from "zod";

import { jev } from "./jev";

export const relevanceJudge = jev({
  run: async (model, input) => z.json().parse(await env.AI.run(model, input)),
});

import { z } from "zod";

import type { PluginEnv } from "../plugin-host";

const jevRequest = z.object({ questions: z.record(z.string(), z.unknown()) });

// Workers AI for development and tests, used under `import.meta.env.DEV`.
// Jev approves every candidate, so recall shows what core returns and
// nothing bills the account. `JEV=1 pnpm eval` runs the real model.
export const devAi: PluginEnv["ai"] = {
  run: (_model, input) => {
    const { questions } = jevRequest.parse(input);
    return Promise.resolve({
      answers: Object.fromEntries(
        Object.keys(questions).map((ref) => [ref, { noul: 1 }])
      ),
    });
  },
};

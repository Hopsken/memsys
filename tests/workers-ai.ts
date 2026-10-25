import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { z } from "zod";

// Tests have no Workers AI, so Jev keeps every memory unless a test says
// otherwise.
const questionsSchema = z.object({ questions: z.record(z.string(), z.json()) });

vi.spyOn(env.AI, "run").mockImplementation((_model, input) =>
  Promise.resolve({
    answers: Object.fromEntries(
      Object.keys(questionsSchema.parse(input).questions).map((ref) => [
        ref,
        { noul: 1 },
      ])
    ),
  })
);

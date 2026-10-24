import { z } from "zod";

type Json = z.output<ReturnType<typeof z.json>>;

export const WORKERS_AI_URL = "https://workers-ai.binding/run/";

export interface WorkersAiBinding {
  run: (model: string, input: Record<string, Json>) => Promise<Json>;
}

const AI_TIMEOUT = 3007;
const AI_OUT_OF_CAPACITY = 3040;
const RETRYABLE_AI_ERROR_CODES = new Set([AI_TIMEOUT, AI_OUT_OF_CAPACITY]);
const AI_ERROR_CODE = /(?:^|\s)(?<code>\d{4}):/u;
const UPSTREAM_GATEWAY_ERROR = /InferenceUpstreamError/u;

const isTransient = (error: Error) => {
  const code =
    z.object({ code: z.number() }).safeParse(error).data?.code ??
    Number(AI_ERROR_CODE.exec(String(error))?.groups?.["code"]);
  return (
    RETRYABLE_AI_ERROR_CODES.has(code) ||
    UPSTREAM_GATEWAY_ERROR.test(String(error))
  );
};

export const workersAiErrorSchema = z.object({ error: z.string() });

// The binding wraps the output of a third-party model, such as typesafe/jev,
// in { state, result }; a Workers AI model's output comes bare.
const thirdPartyRunSchema = z.object({
  result: z.json(),
  state: z.literal("Completed"),
});
const unwrap = (output: Json) =>
  thirdPartyRunSchema.safeParse(output).data?.result ?? output;

// The binding gets no abort signal: a remote binding cannot serialize one.
export const workersAiFetch =
  (binding: WorkersAiBinding) =>
  async (input: Request | URL | string, init?: RequestInit) => {
    const request = new Request(input, init);
    const model = request.url.slice(WORKERS_AI_URL.length);
    const body = z.record(z.string(), z.json()).parse(await request.json());
    try {
      return Response.json(unwrap(await binding.run(model, body)));
    } catch (error) {
      const cause =
        z.instanceof(Error).safeParse(error).data ?? new Error(String(error));
      return Response.json(
        { error: String(cause) },
        { status: isTransient(cause) ? 503 : 400 }
      );
    }
  };

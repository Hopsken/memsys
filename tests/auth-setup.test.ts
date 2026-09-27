import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "../worker/auth";
import worker from "../worker/index";

// Each test gets its own env object, so its own Better Auth instance.
const freshEnv = (): Env => ({ ...env });

describe(getAuth, () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps setup alive past the request that started it", async () => {
    const ctx = createExecutionContext();
    const waitUntil = vi.spyOn(ctx, "waitUntil");
    const bindings = freshEnv();
    const auth = getAuth(bindings, ctx);
    expect(getAuth(bindings, ctx)).toBe(auth);
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitOnExecutionContext(ctx);
    // Setup ran through the schema check, whose clean result is now cached.
    const { checkSchema } = await auth.$context;
    expect(checkSchema).toBeDefined();
    expect(checkSchema?.()).toBeUndefined();
  });

  it("finishes a request even if its client goes away", async () => {
    const ctx = createExecutionContext();
    const waitUntil = vi.spyOn(ctx, "waitUntil");
    const response = worker.fetch(
      new Request("https://memsys.test/.well-known/oauth-protected-resource"),
      freshEnv(),
      ctx
    );
    expect(waitUntil).toHaveBeenCalledWith(response);
    await waitOnExecutionContext(ctx);
  });

  it("replaces an instance whose setup never finished", async () => {
    const bindings = freshEnv();
    const stalled = getAuth(bindings);
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 11_000);
    const replacement = getAuth(bindings);
    expect(replacement).not.toBe(stalled);
    const { checkSchema } = await replacement.$context;
    await checkSchema?.();
    vi.spyOn(Date, "now").mockReturnValue(start + 60_000);
    expect(getAuth(bindings)).toBe(replacement);
  });
});

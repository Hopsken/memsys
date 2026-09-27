import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "../worker/auth";

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
  });

  it("replaces an instance whose setup never finished", async () => {
    const bindings = freshEnv();
    const stalled = getAuth(bindings);
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start + 11_000);
    const replacement = getAuth(bindings);
    expect(replacement).not.toBe(stalled);
    await replacement.$context;
    vi.spyOn(Date, "now").mockReturnValue(start + 60_000);
    expect(getAuth(bindings)).toBe(replacement);
  });
});

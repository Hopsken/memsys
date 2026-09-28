import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "../worker/auth";
import worker from "../worker/index";
import { ORIGIN, randomIp, useAuth } from "./helpers";

// Each test gets its own env object, so its own Better Auth instance.
const freshEnv = (): Env => ({ ...env });

// A database where queries naming `table` never settle, like a query
// canceled along with the request that started it.
const stallingOn = (table: string): D1Database =>
  new Proxy(env.DB, {
    get: (target, key) => {
      if (key === "prepare") {
        return (query: string) =>
          query.includes(`"${table}"`)
            ? { bind: () => ({ all: () => Promise.withResolvers().promise }) }
            : target.prepare(query);
      }
      // SAFETY: a proxy of a D1Database is only read by D1Database keys.
      return target[key as keyof D1Database];
    },
  });

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

// Kysely lets a SQLite database run one query at a time, across every
// request in the isolate. On D1 each query stands alone, so none may wait on
// another request's.
describe("D1 queries", () => {
  const signIn = useAuth();

  it("answers while another request's query never settles", async () => {
    const user = await signIn();
    const bindings = { ...freshEnv(), DB: stallingOn("oauthConsent") };
    const get = (path: string) =>
      worker.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: { Cookie: user.cookie, "cf-connecting-ip": randomIp() },
        }),
        bindings
      );
    const { checkSchema } = await getAuth(bindings).$context;
    await checkSchema?.();
    void get("/api/connections");
    const listed = await Promise.race([
      get("/api/auth/api-key/list"),
      scheduler.wait(2000).then(() => null),
    ]);
    expect(listed?.status).toBe(200);
  });
});

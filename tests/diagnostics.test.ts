import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import worker from "../worker/index";
import { ORIGIN, memoryOf, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const readDiagnostics = (user: User | null) =>
  worker.fetch(
    new Request(`${ORIGIN}/api/diagnostics`, {
      headers: user ? { Cookie: user.cookie } : {},
    }),
    env
  );

const traceFrom = (body: string) => {
  const otherRequests = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation((input, init) =>
    new Request(input, init).url === "https://www.cloudflare.com/cdn-cgi/trace"
      ? Promise.resolve(new Response(body))
      : (otherRequests?.(input, init) ?? Promise.reject(new Error("No mock")))
  );
  return () => {
    if (otherRequests) {
      vi.mocked(fetch).mockImplementation(otherRequests);
    }
  };
};

describe("Diagnostics API", () => {
  const signIn = useAuth();

  it("refuses visitors who are not signed in", async () => {
    const response = await readDiagnostics(null);
    expect(response.status).toBe(401);
  });

  it("reports where the signed-in user's own memory runs", async () => {
    const owner = await signIn();
    const other = await signIn();
    await post("/api/remember", { fragment: "One" }, owner);
    await post("/api/remember", { fragment: "Two" }, owner);
    await post("/api/remember", { fragment: "Elsewhere" }, other);
    const restore = traceFrom("fl=1\nh=www.cloudflare.com\ncolo=HKG\nloc=CN\n");
    const response = await readDiagnostics(owner);
    restore();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toStrictEqual({
      memory: {
        colo: "HKG",
        fragments: 2,
        id: memoryOf(owner).id.toString(),
        roundTripMs: expect.any(Number),
        storageBytes: expect.any(Number),
      },
      userId: owner.id,
      worker: { colo: expect.toBeOneOf([expect.any(String), null]) },
    });
  });

  it("still answers when the memory's location cannot be found", async () => {
    const user = await signIn();
    const restore = traceFrom("unexpected page");
    const unreadable = await readDiagnostics(user);
    restore();
    const unreachable = await readDiagnostics(user);

    expect(unreadable.status).toBe(200);
    expect(unreachable.status).toBe(200);
    await expect(unreadable.json()).resolves.toMatchObject({
      memory: { colo: null },
    });
    await expect(unreachable.json()).resolves.toMatchObject({
      memory: { colo: null },
    });
  });
});

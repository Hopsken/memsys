import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { corpus } from "../worker/dev/corpus";
import worker from "../worker/index";
import { list, useAccess } from "./helpers";

const local = {
  ...env,
  ACCESS_AUD: "",
  ACCESS_ISSUER: "",
  DEV_IDENTITY: "local-test",
};
// RFC corpus labels: f1 is the first seeded fragment.
const label = (text: string) =>
  `f${corpus.findIndex((item) => item.fragment === text) + 1}`;
const post = (path: string, body: string) =>
  new Request(`https://portal.test${path}`, {
    body,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
  });

describe("Development identity", () => {
  const token = useAccess();

  it("shares local memory between REST and stateless MCP without a JWT", async () => {
    const saved = await worker.fetch(
      post(
        "/api/remember",
        JSON.stringify({ fragment: "Local portal memory #dev" })
      ),
      local
    );
    expect(saved.status).toBe(201);
    const { ref } = await saved.json<Fragment>();
    const response = await worker.fetch(
      post(
        "/mcp",
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { cue: "Local portal memory" }, name: "recall" },
        })
      ),
      local
    );
    const body = await response.json<{
      result: { content: { text: string }[] };
    }>();
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toMatchObject({
      fragments: [{ ref }],
    });
    const other = await worker.fetch(
      post("/api/recall", '{"cue":"Local portal memory"}'),
      { ...local, DEV_IDENTITY: "other-local-user" }
    );
    await expect(other.json()).resolves.toMatchObject({ fragments: [] });
    // The same subject under Access must not share the development identity.
    const jwt = await token({ sub: local.DEV_IDENTITY });
    await expect(list(jwt)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("seeds the dev memory with the test corpus, replacing what was there", async () => {
    const identity = { ...local, DEV_IDENTITY: "seed-test" };
    await worker.fetch(
      post("/api/remember", '{"fragment":"Replaced by the seed"}'),
      identity
    );
    const seeded = await worker.fetch(post("/api/dev/seed", "{}"), identity);
    const recalled = await worker.fetch(
      post("/api/recall", '{"cue":"US West"}'),
      identity
    );
    const { fragments } = await recalled.json<{
      fragments: (Fragment & { via?: string[] })[];
    }>();
    await expect(seeded.json()).resolves.toStrictEqual({ fragments: 8 });
    // Today's order is updatedAt; RFC 5's IDF ranking would lift f7 above f4.
    expect(
      fragments.map(({ fragment, via }) => [label(fragment), via])
    ).toStrictEqual([
      ["f2", undefined],
      ["f1", ["cloudflare", "memsys"]],
      ["f4", ["memsys"]],
      ["f6", ["memsys"]],
      ["f7", ["d1", "memsys"]],
    ]);
  });

  it("hides the seed route unless the dev identity is active", async () => {
    const response = await worker.fetch(
      new Request("https://portal.test/api/dev/seed", {
        body: "{}",
        headers: {
          "Cf-Access-Jwt-Assertion": await token(),
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
      env
    );
    expect(response.status).toBe(404);
  });

  it("does not bypass configured Access even when a dev identity is set", async () => {
    await expect(
      worker.fetch(post("/api/recall", '{"cue":"test"}'), {
        ...env,
        DEV_IDENTITY: "local-user",
      })
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      worker.fetch(post("/api/recall", '{"cue":"test"}'), {
        ...local,
        ACCESS_ISSUER: env.ACCESS_ISSUER,
      })
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      worker.fetch(post("/api/recall", '{"cue":"test"}'), {
        ...local,
        DEV_IDENTITY: "",
      })
    ).resolves.toMatchObject({ status: 503 });
  });
});

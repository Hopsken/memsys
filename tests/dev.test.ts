import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import type { Fragment } from "../worker/memory";

const local = {
  ...env,
  ACCESS_AUD: "",
  ACCESS_ISSUER: "",
  DEV_IDENTITY: "local-test",
};
const post = (path: string, body: string) =>
  new Request(`https://portal.test${path}`, {
    body,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
  });

describe("Development identity", () => {
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
      recalled: [{ ref }],
    });
    const other = await worker.fetch(
      post("/api/recall", '{"cue":"Local portal memory"}'),
      { ...local, DEV_IDENTITY: "other-local-user" }
    );
    await expect(other.json()).resolves.toMatchObject({ recalled: [] });
    const authenticatedSpace = env.MEMORY.getByName(
      JSON.stringify([env.ACCESS_ISSUER, "local-test"])
    );
    await expect(
      authenticatedSpace.recall({ cue: "Local portal memory" })
    ).resolves.toMatchObject({ recalled: [] });
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

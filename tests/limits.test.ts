import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { call, content, list, post, useAccess } from "./helpers";

type WriteResult = (Fragment & { warnings?: string[] }) | { error: string };

const write = async (
  jwt: string,
  transport: string,
  args: { fragment: string; ref?: string }
): Promise<WriteResult> => {
  const name = args.ref ? "revise" : "remember";
  if (transport === "MCP") {
    const result = await call(jwt, name, args);
    return result.isError
      ? { error: result.content[0]?.text ?? "" }
      : content<WriteResult>(result);
  }
  const response = await post(`/api/${name}`, args, jwt);
  return response.json<WriteResult>();
};

const warnings = (result: WriteResult) =>
  "error" in result ? "error" : (result.warnings?.length ?? 0);

describe("Fragment length limits", () => {
  const token = useAccess();

  it.each(["REST", "MCP"])(
    "%s warns above 300 and rejects above 500 by default without writing",
    async (transport) => {
      const jwt = await token();
      const saved = await write(jwt, transport, { fragment: "x" });
      const ref = "ref" in saved ? saved.ref : "";
      const results = await Promise.all(
        [300, 301, 500, 501].flatMap((length) => [
          write(jwt, transport, { fragment: "x".repeat(length) }),
          write(jwt, transport, { fragment: "y".repeat(length), ref }),
        ])
      );
      expect(results.map(warnings)).toStrictEqual([
        0,
        0,
        1,
        1,
        1,
        1,
        "error",
        "error",
      ]);
      const page = await list(jwt);
      expect(page.fragments).toHaveLength(4);
    }
  );

  it("returns 422 for plugin rejections and 400 above the core ceiling", async () => {
    const jwt = await token();
    const statuses = await Promise.all(
      [501, 1000, 1001].map(async (length) => {
        const response = await post(
          "/api/remember",
          { fragment: "x".repeat(length) },
          jwt
        );
        return response.status;
      })
    );
    expect(statuses).toStrictEqual([422, 422, 400]);
  });

  it("applies per-instance limits and keeps the core ceiling when disabled", async () => {
    const sub = crypto.randomUUID();
    const jwt = await token({ sub });
    const memory = env.MEMORY.getByName(
      JSON.stringify([env.ACCESS_ISSUER, sub])
    );
    const strict = await memory.updatePlugin("size-limit", {
      config: { hard: 10, soft: 5 },
      enabled: true,
      updatedAt: null,
    });
    const tight = await Promise.all(
      [5, 6, 11].map(async (length) =>
        warnings(await write(jwt, "MCP", { fragment: "x".repeat(length) }))
      )
    );
    const { updatedAt } = await strict.json<{ updatedAt: number }>();
    await memory.updatePlugin("size-limit", {
      config: { hard: 10, soft: 5 },
      enabled: false,
      updatedAt,
    });
    const off = await Promise.all(
      [1000, 1001].map(async (length) =>
        warnings(await write(jwt, "MCP", { fragment: "x".repeat(length) }))
      )
    );
    expect({ off, tight }).toStrictEqual({
      off: [0, "error"],
      tight: [0, 1, "error"],
    });
  });
});

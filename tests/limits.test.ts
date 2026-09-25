import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { call, content, list, memoryOf, post, useAuth } from "./helpers";
import type { User } from "./helpers";

type WriteResult = (Fragment & { warnings?: string[] }) | { error: string };

const write = async (
  user: User,
  transport: string,
  args: { fragment: string; ref?: string }
): Promise<WriteResult> => {
  const name = args.ref ? "revise" : "remember";
  if (transport === "MCP") {
    const result = await call(user, name, args);
    return result.isError
      ? { error: result.content[0]?.text ?? "" }
      : content<WriteResult>(result);
  }
  const response = await post(`/api/${name}`, args, user);
  return response.json<WriteResult>();
};

const warnings = (result: WriteResult) =>
  "error" in result ? "error" : (result.warnings?.length ?? 0);

describe("Fragment length limits", () => {
  const signIn = useAuth();

  it.each(["REST", "MCP"])(
    "%s warns above 300 and rejects above 500 by default without writing",
    async (transport) => {
      const user = await signIn();
      const saved = await write(user, transport, { fragment: "x" });
      const ref = "ref" in saved ? saved.ref : "";
      const results = await Promise.all(
        [300, 301, 500, 501].flatMap((length) => [
          write(user, transport, { fragment: "x".repeat(length) }),
          write(user, transport, { fragment: "y".repeat(length), ref }),
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
      const page = await list(user);
      expect(page.fragments).toHaveLength(4);
    }
  );

  it("returns 422 for plugin rejections and 400 above the core ceiling", async () => {
    const user = await signIn();
    const statuses = await Promise.all(
      [501, 1000, 1001].map(async (length) => {
        const response = await post(
          "/api/remember",
          { fragment: "x".repeat(length) },
          user
        );
        return response.status;
      })
    );
    expect(statuses).toStrictEqual([422, 422, 400]);
  });

  it("applies per-instance limits and keeps the core ceiling when disabled", async () => {
    const user = await signIn();
    const memory = memoryOf(user);
    const strict = await memory.updatePlugin("size-limit", {
      config: { hard: 10, soft: 5 },
      enabled: true,
      updatedAt: null,
    });
    const tight = await Promise.all(
      [5, 6, 11].map(async (length) =>
        warnings(await write(user, "MCP", { fragment: "x".repeat(length) }))
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
        warnings(await write(user, "MCP", { fragment: "x".repeat(length) }))
      )
    );
    expect({ off, tight }).toStrictEqual({
      off: [0, "error"],
      tight: [0, 1, "error"],
    });
  });
});

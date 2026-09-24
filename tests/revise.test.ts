import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { call, content, list, post, useAccess } from "./helpers";

describe("Revise", () => {
  const token = useAccess();

  it.each(["REST", "MCP"])(
    "%s replaces the full text literally and preserves identity",
    async (transport) => {
      const jwt = await token();
      const saved = await post(
        "/api/remember",
        { fragment: "Before\n旧内容 #old\nAfter" },
        jwt
      );
      const item = await saved.json<Fragment>();
      const input = { fragment: "$& $1 $` $' #new", ref: item.ref };
      const revise = async () => {
        if (transport === "MCP") {
          return content<Fragment>(await call(jwt, "revise", input));
        }
        const response = await post("/api/revise", input, jwt);
        return response.json<Fragment>();
      };
      const revised = await revise();
      expect(revised).toMatchObject({
        createdAt: item.createdAt,
        fragment: "$& $1 $` $' #new",
        ref: item.ref,
      });
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [revised],
        nextCursor: null,
      });
    }
  );

  it.each([
    { fragment: "" },
    { fragment: " \n" },
    { fragment: "x".repeat(501) },
    // Clients still sending the retired text-edit shape must fail loudly.
    { new_string: "new", old_string: "keep" },
  ])(
    "leaves content and timestamps unchanged for invalid MCP input (%#)",
    async (args) => {
      const jwt = await token();
      const saved = await post("/api/remember", { fragment: "keep" }, jwt);
      const item = await saved.json<Fragment>();
      const result = await call(jwt, "revise", { ...args, ref: item.ref });
      expect(result.isError).toBeTruthy();
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [item],
        nextCursor: null,
      });
    }
  );
});

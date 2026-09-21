import { describe, expect, it } from "vitest";

import type { Fragment } from "../worker/memory";
import { call, content, list, post, useAccess } from "./helpers";

describe("MCP text edits", () => {
  const token = useAccess();

  it("treats replacement text literally and preserves surrounding text and identity", async () => {
    const jwt = await token();
    const saved = await post(
      "/api/remember",
      { fragment: "Before\n旧内容 #old\nAfter" },
      jwt
    );
    const item = await saved.json<Fragment>();
    const edited = await call(jwt, "revise", {
      new_string: "$& $1 $` $' #new",
      old_string: "旧内容 #old",
      ref: item.ref,
    });
    expect(content(edited)).toMatchObject({
      createdAt: item.createdAt,
      fragment: "Before\n$& $1 $` $' #new\nAfter",
      ref: item.ref,
    });
    const deleted = await call(jwt, "revise", {
      new_string: "",
      old_string: "$& $1 $` $' ",
      ref: item.ref,
    });
    expect(content(deleted)).toMatchObject({ fragment: "Before\n#new\nAfter" });
    await expect(list(jwt)).resolves.toMatchObject({
      fragments: [{ fragment: "Before\n#new\nAfter", ref: item.ref }],
    });
  });

  it.each([
    ["Case  sensitive", "case  sensitive", "new", false],
    ["Case  sensitive", "Case sensitive", "new", false],
    ["one one", "one", "new", false],
    ["aaa", "aa", "new", false],
    ["remove", "remove", "", false],
    ["remove", "remove", " \n", false],
    ["ab", "a", "x".repeat(500), false],
    ["keep", "", "new", false],
    ["a a", "missing", "b", true],
    ["aa", "a", "x".repeat(251), true],
    ["aa", "a", "", true],
  ])(
    "leaves content and timestamps unchanged when an edit cannot apply (%#)",
    async (fragment, oldString, newString, replaceAll) => {
      const jwt = await token();
      const saved = await post("/api/remember", { fragment }, jwt);
      const item = await saved.json<Fragment>();
      const edited = await call(jwt, "revise", {
        new_string: newString,
        old_string: oldString,
        ref: item.ref,
        replaceAll,
      });
      expect(edited.isError).toBeTruthy();
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [item],
        nextCursor: null,
      });
    }
  );

  it.each([
    ["a #old b #old c", "#old", "$& #new", "a $& #new b $& #new c"],
    ["aaa", "aa", "x", "xa"],
    ["a-a-b", "a-", "", "b"],
  ])(
    "replaces all non-overlapping literal matches (%#)",
    async (fragment, oldString, newString, expected) => {
      const jwt = await token();
      const saved = await post("/api/remember", { fragment }, jwt);
      const item = await saved.json<Fragment>();
      const result = content<Fragment>(
        await call(jwt, "revise", {
          new_string: newString,
          old_string: oldString,
          ref: item.ref,
          replaceAll: true,
        })
      );
      expect(result).toMatchObject({
        createdAt: item.createdAt,
        fragment: expected,
        ref: item.ref,
      });
      await expect(list(jwt)).resolves.toStrictEqual({
        fragments: [result],
        nextCursor: null,
      });
    }
  );

  it("keeps HTTP full replacement separate from MCP edits", async () => {
    const jwt = await token();
    const saved = await post(
      "/api/remember",
      { fragment: "a old b old c" },
      jwt
    );
    const item = await saved.json<Fragment>();
    const input = { new_string: "new", old_string: "old", ref: item.ref };
    await expect(post("/api/revise", input, jwt)).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      call(jwt, "revise", { fragment: "new text", ref: item.ref })
    ).resolves.toMatchObject({ isError: true });
    // Omitting replaceAll must reject an ambiguous match, not replace every match.
    await expect(call(jwt, "revise", input)).resolves.toMatchObject({
      isError: true,
    });
    const revised = await post(
      "/api/revise",
      { fragment: "Entirely new text", ref: item.ref },
      jwt
    );
    await expect(revised.json()).resolves.toMatchObject({
      createdAt: item.createdAt,
      fragment: "Entirely new text",
      ref: item.ref,
    });
  });
});

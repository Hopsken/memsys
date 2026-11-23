import type { Fragment } from "@core";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import { list, post, useAuth, withVersions } from "./helpers";

describe("Revise", () => {
  const signIn = useAuth();

  it("replaces the full text literally and preserves identity", async () => {
    const user = await signIn();
    const saved = await post(
      "/api/remember",
      { fragment: "Before\n旧内容 #old\nAfter" },
      user
    );
    const item = await saved.json<Fragment>();
    const response = await post(
      "/api/revise",
      { fragment: "$& $1 $` $' #new", ref: item.ref },
      user
    );
    const revised = await response.json<Fragment>();
    expect(revised).toMatchObject({
      fragment: "$& $1 $` $' #new",
      ref: item.ref,
    });
    expect(revised.versionId).toBeGreaterThan(item.versionId);
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [withVersions(revised, 2, "user")],
      nextCursor: null,
    });
  });

  it.each<[Record<string, JSONValue>, boolean]>([
    [{ fragment: "" }, true],
    [{ fragment: " \n" }, true],
    [{ fragment: "x".repeat(501) }, true],
    [{ new_string: "new", old_string: "keep" }, true],
    [{ fragment: "new" }, false],
  ])(
    "leaves content and timestamps unchanged for invalid input (%#)",
    async (args, withRef) => {
      const user = await signIn();
      const saved = await post("/api/remember", { fragment: "keep" }, user);
      const item = await saved.json<Fragment>();
      const response = await post(
        "/api/revise",
        withRef ? { ...args, ref: item.ref } : args,
        user
      );
      expect(response.ok).toBeFalsy();
      await expect(list(user)).resolves.toStrictEqual({
        fragments: [withVersions(item)],
        nextCursor: null,
      });
    }
  );
});

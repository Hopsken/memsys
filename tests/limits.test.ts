import { describe, expect, it } from "vitest";

import type { Fragment } from "../worker/memory";
import { call, content, list, post, useAccess } from "./helpers";

type WriteResult = Fragment & { warnings?: string[] };

describe("Fragment length limits", () => {
  const token = useAccess();

  it.each(["REST", "MCP"])(
    "%s counts graphemes, warns on long text, and rejects oversized writes atomically",
    async (transport) => {
      const jwt = await token();
      const write = async (
        fragment: string,
        previous?: Fragment
      ): Promise<WriteResult | null> => {
        const name = previous ? "revise" : "remember";
        if (transport === "MCP") {
          const result = await call(
            jwt,
            name,
            previous
              ? {
                  new_string: fragment,
                  old_string: previous.fragment,
                  ref: previous.ref,
                }
              : { fragment }
          );
          return result.isError ? null : content<WriteResult>(result);
        }
        const response = await post(
          `/api/${name}`,
          previous ? { fragment, ref: previous.ref } : { fragment },
          jwt
        );
        if (response.status === 400) {
          return null;
        }
        expect(response.status).toBe(previous ? 200 : 201);
        return response.json<WriteResult>();
      };

      // Six graphemes; UTF-16 units and Unicode code points give different lengths.
      const unit = "中a👍🏽👨‍👩‍👧‍👦e\u0301🇨🇳";
      const oversized = unit.repeat(46) + "文".repeat(5);
      const saved = await Promise.all(
        [140, 141, 280].map(async (length) => {
          const fragment =
            unit.repeat(Math.floor(length / 6)) + "文".repeat(length % 6);
          const created = await write(fragment);
          expect(created?.fragment).toBe(fragment);
          expect(created?.warnings?.length ?? 0).toBe(length > 140 ? 1 : 0);
          const revised = await write(
            `改${fragment.slice(1)}`,
            created ?? undefined
          );
          expect(revised?.fragment).toBe(`改${fragment.slice(1)}`);
          expect(revised?.warnings?.length ?? 0).toBe(length > 140 ? 1 : 0);
          const page = await list(jwt);
          expect(page.fragments).toContainEqual({
            createdAt: created?.createdAt,
            fragment: `改${fragment.slice(1)}`,
            ref: created?.ref,
            updatedAt: revised?.updatedAt,
          });
          return revised;
        })
      );

      const before = await list(jwt);
      await expect(write(oversized)).resolves.toBeNull();
      await expect(write(oversized, saved[2] ?? undefined)).resolves.toBeNull();
      await expect(list(jwt)).resolves.toStrictEqual(before);
      expect(before.fragments).toHaveLength(3);
      const shortened = await write("短", saved[2] ?? undefined);
      expect({
        fragment: shortened?.fragment,
        warnings: shortened?.warnings,
      }).toStrictEqual({ fragment: "短", warnings: undefined });
    }
  );
});

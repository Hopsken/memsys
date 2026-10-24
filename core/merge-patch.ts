import { z } from "zod";

import type { Json, JsonObject } from "@contract/memory";

const jsonObject = z.record(z.string(), z.json());

export const mergePatch = (
  target: Json | undefined,
  patch: JsonObject
): JsonObject => {
  const base: JsonObject = jsonObject.safeParse(target).data ?? {};
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  return Object.fromEntries(
    [...keys].flatMap((key): [string, Json][] => {
      const value = patch[key];
      if (value === undefined) {
        const kept = base[key];
        return kept === undefined ? [] : [[key, kept]];
      }
      if (value === null) {
        return [];
      }
      const nested = jsonObject.safeParse(value);
      return [
        [key, nested.success ? mergePatch(base[key], nested.data) : value],
      ];
    })
  );
};

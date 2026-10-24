import { z } from "zod";

import type { Metadata } from "./api";

const jsonObject = z.record(z.string(), z.json());

type Json = z.output<ReturnType<typeof z.json>>;

export const mergePatch = (
  target: Json | Metadata | undefined,
  patch: Metadata
): Record<string, Json> => {
  const changes = jsonObject.parse(patch);
  const base = jsonObject.safeParse(target).data ?? {};
  const keys = new Set([...Object.keys(base), ...Object.keys(changes)]);
  return Object.fromEntries(
    [...keys].flatMap((key): [string, Json][] => {
      const value = changes[key];
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

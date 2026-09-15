import { z } from "zod";

// Lowercase only; omit 0, 1, i, l, and o. 31^7 possible refs.
export const REF_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const REF_LENGTH = 7;
export const RESULT_LIMIT = 20;

const fragment = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim().length > 0);
const ref = z
  .string()
  .length(REF_LENGTH)
  .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/u);

export const inputs = {
  forget: z.object({ ref }).strict(),
  recall: z.object({ cue: z.string().trim().min(1).max(256) }).strict(),
  remember: z.object({ fragment }).strict(),
  revise: z.object({ fragment, ref }).strict(),
};

export interface Fragment {
  ref: string;
  fragment: string;
  createdAt: string;
  updatedAt: string;
}

const normalize = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/gu, " ").trim();

export const extractAnchors = (text: string): string[] =>
  [
    ...new Set(
      [
        ...text.matchAll(
          /(?:^|[^\p{L}\p{N}_/#])#(?<anchor>[\p{L}\p{N}_/-]+)/gu
        ),
      ].map((match) => (match.groups?.anchor ?? "").toLowerCase())
    ),
  ].toSorted();

export const recall = (corpus: Iterable<Fragment>, cue: string) => {
  const ordered = [...corpus].toSorted(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.ref.localeCompare(b.ref)
  );
  const normalizedCue = normalize(cue);
  const matches = ordered.filter((item) =>
    normalize(item.fragment).includes(normalizedCue)
  );
  const recalled = matches.slice(0, RESULT_LIMIT).map((item) => ({
    ...item,
    anchors: extractAnchors(item.fragment),
  }));
  const refs = new Set(matches.map((item) => item.ref));
  const anchors = new Set(recalled.flatMap((item) => item.anchors));
  const associated = ordered
    .filter((item) => !refs.has(item.ref))
    .map((item) => ({
      ...item,
      sharedAnchors: extractAnchors(item.fragment).filter((anchor) =>
        anchors.has(anchor)
      ),
    }))
    .filter((item) => item.sharedAnchors.length > 0);

  return {
    associated: associated.slice(0, RESULT_LIMIT),
    hasMoreAssociated: associated.length > RESULT_LIMIT,
    hasMoreRecalled: matches.length > RESULT_LIMIT,
    recalled,
  };
};

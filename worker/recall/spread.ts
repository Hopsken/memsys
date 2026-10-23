import type { RecallStage } from "../../contract/plugin";
import { associationKeys, extractAnchors } from "../../lib/anchor";
import { newestFirst } from "./match";

// Built-in stage: adds the fragments that share an anchor with a cue match,
// one hop, newest first. `via` lists the shared anchors. The first `limit`
// cue matches seed it.
export const spread: RecallStage<unknown> = (
  { corpus },
  items,
  { associate, limit }
) => {
  const seeds = items.filter((item) => !item.via).slice(0, limit);
  const keys = new Set(
    associate
      ? seeds.flatMap((item) =>
          extractAnchors(item.fragment).flatMap(associationKeys)
        )
      : []
  );
  if (keys.size === 0) {
    return Promise.resolve({ items: [...items] });
  }
  const present = new Set(items.map((item) => item.ref));
  const associated = newestFirst(corpus.values())
    .filter((item) => !present.has(item.ref))
    .map((item) => ({
      ref: item.ref,
      via: extractAnchors(item.fragment).filter((anchor) =>
        associationKeys(anchor).some((key) => keys.has(key))
      ),
    }))
    .filter((item) => item.via.length > 0);
  return Promise.resolve({ items: [...items, ...associated] });
};

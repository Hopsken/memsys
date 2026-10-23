import type { RecallStage } from "../../contract/plugin";
import { associationKeys, extractAnchors } from "../../lib/anchor";
import { newestFirst } from "./match";

const SEEDS = 10;

// Built-in stage: adds the fragments that share an anchor with one of the
// first cue matches, one hop, newest first. `via` lists the shared anchors.
export const spread: RecallStage<unknown> = ({ corpus }, items) => {
  const seeds = items.filter((item) => !item.via).slice(0, SEEDS);
  const keys = new Set(
    seeds.flatMap((item) =>
      extractAnchors(item.fragment).flatMap(associationKeys)
    )
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

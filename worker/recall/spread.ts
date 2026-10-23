import type { RecallStage } from "../../contract/plugin";
import { associationKeys, extractAnchors } from "../../lib/anchor";
import { newestFirst } from "./match";

const SEEDS = 10;
// A hub anchor can link most of the corpus; later stages need far fewer.
const ADDED = 100;

// Built-in stage: adds the fragments that share an anchor with one of the
// first cue matches, one hop, newest first, up to ADDED. `via` lists the
// shared anchors. The cut is not reported: no better cue brings those
// fragments back through spreading (RFC 0002, decision 6).
export const spread: RecallStage<null> = ({ corpus }, items) => {
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
    .filter((item) => item.via.length > 0)
    .slice(0, ADDED);
  return Promise.resolve({ items: [...items, ...associated] });
};

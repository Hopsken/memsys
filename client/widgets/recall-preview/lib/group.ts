import type { RecallItem } from "@contract/memory";
import { associationKeys, extractAnchors } from "@lib/anchor";

// A match and the memories it brought along. `match` is null for related
// memories whose match isn't in the result.
export interface RecallGroup {
  match: RecallItem | null;
  related: RecallItem[];
}

// Puts each related memory under the first match that shares one of its
// tags, the way recall associated them.
export const groupByMatch = (items: readonly RecallItem[]): RecallGroup[] => {
  const groups = items
    .filter((item) => !item.via)
    .map((match) => ({
      keys: new Set(extractAnchors(match.fragment).flatMap(associationKeys)),
      match,
      related: new Array<RecallItem>(),
    }));
  const loose: RecallItem[] = [];
  for (const item of items) {
    if (!item.via) {
      continue;
    }
    const keys = item.via.flatMap(associationKeys);
    const group = groups.find((each) => keys.some((key) => each.keys.has(key)));
    (group?.related ?? loose).push(item);
  }
  return [
    ...groups.map(({ match, related }) => ({ match, related })),
    ...(loose.length > 0 ? [{ match: null, related: loose }] : []),
  ];
};

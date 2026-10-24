import type { RecallItem } from "@/shared/api";
import { associationKeys, extractAnchors } from "@lib/anchor";

export interface RecallGroup {
  match: RecallItem | null;
  related: RecallItem[];
}

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

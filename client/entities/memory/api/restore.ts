import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { api } from "@/shared/api";
import type { FragmentPage, History, Restored } from "@contract/memory";

type ListData = InfiniteData<FragmentPage>;

// Where a memory sat in each loaded list, whole or filtered, keyed by the
// list's query hash, so Undo can put it back there.
type Positions = Map<string, { index: number; page: number }>;

const lists = (queryClient: QueryClient) =>
  queryClient.getQueriesData<ListData>({ queryKey: ["fragments"] });

export const removeFromList = (
  queryClient: QueryClient,
  ref: string
): Positions => {
  const positions: Positions = new Map();
  for (const [key, data] of lists(queryClient)) {
    const pages = data?.pages ?? [];
    const page = pages.findIndex(({ fragments }) =>
      fragments.some((item) => item.ref === ref)
    );
    if (page !== -1) {
      const index =
        pages[page]?.fragments.findIndex((item) => item.ref === ref) ?? -1;
      positions.set(hashKey(key), { index, page });
      queryClient.setQueryData<ListData>(
        key,
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((each) => ({
              ...each,
              fragments: each.fragments.filter((item) => item.ref !== ref),
            })),
          }
      );
    }
  }
  return positions;
};

// A restored memory keeps its place in each loaded list, or returns to the
// place it was forgotten from, until the list reloads; restoring never makes
// a row jump out of view. A list it was in neither way reloads.
const showInList = (
  queryClient: QueryClient,
  restored: Restored,
  positions: Positions
) => {
  const { at, fragment, ref, versions } = restored;
  if (fragment === null) {
    return;
  }
  const item = { at, fragment, ref, versions };
  for (const [key, data] of lists(queryClient)) {
    const position = positions.get(hashKey(key));
    const listed = data?.pages.some(({ fragments }) =>
      fragments.some((each) => each.ref === ref)
    );
    if (!listed && !(position && data?.pages[position.page])) {
      void queryClient.invalidateQueries({ exact: true, queryKey: key });
      continue;
    }
    queryClient.setQueryData<ListData>(
      key,
      (current) =>
        current && {
          ...current,
          pages: current.pages.map((page, index) => {
            if (listed) {
              return {
                ...page,
                fragments: page.fragments.map((each) =>
                  each.ref === ref ? item : each
                ),
              };
            }
            return position && index === position.page
              ? {
                  ...page,
                  fragments: page.fragments.toSpliced(position.index, 0, item),
                }
              : page;
          }),
        }
    );
  }
};

export const restoreVersion = async (
  queryClient: QueryClient,
  { at, ref }: { at: string; ref: string },
  positions: Positions = new Map()
) => {
  const restored = await api
    .post(`/api/fragments/${ref}/restore`, { json: { at } })
    .json<Restored>();
  queryClient.setQueryData<History>(
    ["history", ref],
    (data) =>
      data && {
        versions: [
          { at: restored.at, fragment: restored.fragment, ref },
          ...data.versions,
        ],
      }
  );
  showInList(queryClient, restored, positions);
  void queryClient.invalidateQueries({ queryKey: ["forgotten"] });
  return restored;
};

export const useRestore = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: { at: string; ref: string }) =>
      restoreVersion(queryClient, version),
  });
};

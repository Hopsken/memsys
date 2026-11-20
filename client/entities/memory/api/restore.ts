import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/shared/api";
import type { FragmentPage, History, ListedFragment } from "@/shared/api";

type ListData = InfiniteData<FragmentPage>;

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

const showInList = (
  queryClient: QueryClient,
  item: ListedFragment | null,
  positions: Positions
) => {
  if (item === null) {
    void queryClient.invalidateQueries({ queryKey: ["fragments"] });
    return;
  }
  const { ref, source } = item;
  for (const [key, data] of lists(queryClient)) {
    const position = positions.get(hashKey(key));
    const listed = data?.pages.some(({ fragments }) =>
      fragments.some((each) => each.ref === ref)
    );
    const [, filteredSource] = key;
    if (
      (filteredSource !== null && filteredSource !== source) ||
      (!listed && !(position && data?.pages[position.page]))
    ) {
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
  { id, ref }: { id: number; ref: string },
  positions: Positions = new Map()
) => {
  const restored = await parseResponse(
    api.fragments[":ref"].restore.$post({ json: { id }, param: { ref } })
  );
  queryClient.setQueryData<History>(
    ["history", ref],
    (data) => data && { versions: [restored.version, ...data.versions] }
  );
  showInList(
    queryClient,
    restored.fragment === null
      ? null
      : { ...restored.fragment, versions: restored.versions },
    positions
  );
  void queryClient.invalidateQueries({ queryKey: ["forgotten"] });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
  return restored;
};

export const useRestore = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: { id: number; ref: string }) =>
      restoreVersion(queryClient, version),
  });
};

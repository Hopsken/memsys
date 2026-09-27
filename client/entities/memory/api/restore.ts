import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { api } from "@/shared/api";
import type { FragmentPage, History, Restored } from "@contract/memory";

type ListData = InfiniteData<FragmentPage>;

// Where a memory sat in the loaded list, so Undo can put it back there.
interface Position {
  index: number;
  page: number;
}

export const removeFromList = (
  queryClient: QueryClient,
  ref: string
): Position | null => {
  const pages = queryClient.getQueryData<ListData>(["fragments"])?.pages ?? [];
  for (const [page, { fragments }] of pages.entries()) {
    const index = fragments.findIndex((item) => item.ref === ref);
    if (index !== -1) {
      queryClient.setQueryData<ListData>(
        ["fragments"],
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((each) => ({
              ...each,
              fragments: each.fragments.filter((item) => item.ref !== ref),
            })),
          }
      );
      return { index, page };
    }
  }
  return null;
};

// A restored memory keeps its place in the loaded list, or returns to the
// place it was forgotten from, until the list reloads; restoring never makes
// a row jump out of view.
const showInList = (
  queryClient: QueryClient,
  restored: Restored,
  position: Position | null
) => {
  const { at, fragment, ref, versions } = restored;
  if (fragment === null) {
    return;
  }
  const item = { at, fragment, ref, versions };
  const pages = queryClient.getQueryData<ListData>(["fragments"])?.pages;
  const listed = pages?.some(({ fragments }) =>
    fragments.some((each) => each.ref === ref)
  );
  if (!listed && !(position && pages?.[position.page])) {
    void queryClient.invalidateQueries({ queryKey: ["fragments"] });
    return;
  }
  queryClient.setQueryData<ListData>(
    ["fragments"],
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page, index) => {
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
};

export const restoreVersion = async (
  queryClient: QueryClient,
  { at, ref }: { at: string; ref: string },
  position: Position | null = null
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
  showInList(queryClient, restored, position);
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

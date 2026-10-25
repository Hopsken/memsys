import { useLocation, useSearchParams } from "react-router";

export const useTags = () => {
  const [params] = useSearchParams();
  return [...new Set(params.getAll("tag").map((tag) => tag.toLowerCase()))];
};

export const useFilteredList = () => {
  const { pathname, search } = useLocation();
  const by = pathname.startsWith("/memories")
    ? new URLSearchParams(search).get("by")
    : null;
  return (tags: string[]) => {
    const params = new URLSearchParams(tags.map((tag) => ["tag", tag]));
    if (by !== null) {
      params.set("by", by);
    }
    return {
      pathname: "/memories",
      search: params.size > 0 ? `?${params}` : "",
    };
  };
};

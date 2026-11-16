import { useLocation, useSearchParams } from "react-router";

export const useTags = () => {
  const [params] = useSearchParams();
  return [...new Set(params.getAll("tag").map((tag) => tag.toLowerCase()))];
};

export const useFilteredList = () => {
  const { pathname, search } = useLocation();
  const from = pathname.startsWith("/memories")
    ? new URLSearchParams(search).get("from")
    : null;
  return (tags: string[]) => {
    const params = new URLSearchParams(tags.map((tag) => ["tag", tag]));
    if (from !== null) {
      params.set("from", from);
    }
    return {
      pathname: "/memories",
      search: params.size > 0 ? `?${params}` : "",
    };
  };
};

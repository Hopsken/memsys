import { useLocation, useSearchParams } from "react-router";

export const useTags = () => {
  const [params] = useSearchParams();
  return [...new Set(params.getAll("tag").map((tag) => tag.toLowerCase()))];
};

export const useFilteredList = () => {
  const { pathname, search } = useLocation();
  const source = pathname.startsWith("/memories")
    ? new URLSearchParams(search).get("source")
    : null;
  return (tags: string[]) => {
    const params = new URLSearchParams(tags.map((tag) => ["tag", tag]));
    if (source !== null) {
      params.set("source", source);
    }
    return {
      pathname: "/memories",
      search: params.size > 0 ? `?${params}` : "",
    };
  };
};

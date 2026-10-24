import { useSearchParams } from "react-router";

export const useTags = () => {
  const [params] = useSearchParams();
  return [...new Set(params.getAll("tag").map((tag) => tag.toLowerCase()))];
};

export const filteredList = (tags: string[]) => ({
  pathname: "/memories",
  search:
    tags.length > 0
      ? `?${new URLSearchParams(tags.map((tag) => ["tag", tag]))}`
      : "",
});

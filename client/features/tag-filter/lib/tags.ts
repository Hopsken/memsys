import { useSearchParams } from "react-router";

// The list's filter lives in the URL, `/?tag=a&tag=b`, so Back undoes each
// step and a filtered list can be shared. A memory must carry every tag.
export const useTags = () => {
  const [params] = useSearchParams();
  return [...new Set(params.getAll("tag").map((tag) => tag.toLowerCase()))];
};

// The list filtered by `tags`; no tags is the whole list.
export const filteredList = (tags: string[]) => ({
  pathname: "/",
  search:
    tags.length > 0
      ? `?${new URLSearchParams(tags.map((tag) => ["tag", tag]))}`
      : "",
});

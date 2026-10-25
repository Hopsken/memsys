import { useSearchParams } from "react-router";

import { isAuthor } from "@/entities/persona";
import type { Author } from "@/shared/api";

export const useAuthorParam = () => {
  const [params, setParams] = useSearchParams();
  const value = params.get("by");
  const by = isAuthor(value) ? value : null;
  const setBy = (next: Author | null) => {
    setParams((current) => {
      if (next === null) {
        current.delete("by");
      } else {
        current.set("by", next);
      }
      return current;
    });
    window.scrollTo({ top: 0 });
  };
  return [by, setBy] as const;
};

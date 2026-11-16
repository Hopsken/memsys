import { useSearchParams } from "react-router";

import { isSource } from "@/entities/persona";
import type { Source } from "@/shared/api";

export const useSourceParam = () => {
  const [params, setParams] = useSearchParams();
  const value = params.get("source");
  const source = isSource(value) ? value : null;
  const setSource = (next: Source | null) => {
    setParams((current) => {
      if (next === null) {
        current.delete("source");
      } else {
        current.set("source", next);
      }
      return current;
    });
    window.scrollTo({ top: 0 });
  };
  return [source, setSource] as const;
};

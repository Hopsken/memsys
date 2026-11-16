import { useSearchParams } from "react-router";

import { isSource } from "@/entities/persona";
import type { Source } from "@/shared/api";

export const useSourceParam = () => {
  const [params, setParams] = useSearchParams();
  const value = params.get("from");
  const from = isSource(value) ? value : null;
  const setFrom = (next: Source | null) => {
    setParams((current) => {
      if (next === null) {
        current.delete("from");
      } else {
        current.set("from", next);
      }
      return current;
    });
    window.scrollTo({ top: 0 });
  };
  return [from, setFrom] as const;
};

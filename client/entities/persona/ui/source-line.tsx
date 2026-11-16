import type { Source } from "@/shared/api";

import { usePersonas } from "../api/personas";
import { sourceLabel } from "../lib/source";

export const SourceLine = ({
  from,
  onSelect,
  withFrom = true,
}: {
  from: Source | null;
  onSelect?: (from: Source) => void;
  withFrom?: boolean;
}) => {
  const personas = usePersonas();
  if (from === null) {
    return null;
  }
  const label = sourceLabel(from, personas.data);
  if (!label) {
    return null;
  }
  const name = !withFrom && label.name === "you" ? "You" : label.name;
  return (
    <span className="inline-flex items-center gap-1">
      {withFrom ? "from " : null}
      {onSelect ? (
        <button
          className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(from);
          }}
          title={`Filter by ${label.name}`}
          type="button"
        >
          {name}
        </button>
      ) : (
        name
      )}
    </span>
  );
};

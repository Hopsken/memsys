import type { Source } from "@/shared/api";

import { usePersonas } from "../api/personas";
import { sourceLabel } from "../lib/source";

export const SourceLine = ({
  onSelect,
  source,
  withPrefix = true,
}: {
  onSelect?: (source: Source) => void;
  source: Source | null;
  withPrefix?: boolean;
}) => {
  const personas = usePersonas();
  if (source === null) {
    return null;
  }
  const label = sourceLabel(source, personas.data);
  if (!label) {
    return null;
  }
  const name = !withPrefix && label.name === "you" ? "You" : label.name;
  return (
    <span className="inline-flex items-center gap-1">
      {withPrefix ? "from " : null}
      {onSelect ? (
        <button
          className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(source);
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

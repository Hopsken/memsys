import type { Author } from "@/shared/api";

import { usePersonas } from "../api/personas";
import { authorLabel } from "../lib/author";

export const Byline = ({
  by,
  onSelect,
  withBy = true,
}: {
  by: Author | null;
  onSelect?: (by: Author) => void;
  withBy?: boolean;
}) => {
  const personas = usePersonas();
  if (by === null) {
    return null;
  }
  const label = authorLabel(by, personas.data);
  if (!label) {
    return null;
  }
  const name = !withBy && label.name === "you" ? "You" : label.name;
  return (
    <span className="inline-flex items-center gap-1">
      {withBy ? "by " : null}
      {onSelect ? (
        <button
          className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(by);
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

import type { Author } from "@/shared/api";
import { Badge } from "@/shared/ui/badge";

import { usePersonas } from "../api/personas";
import { authorLabel } from "../lib/author";

export const ArchivedBadge = () => (
  <Badge className="h-4 px-1.5 text-[11px] font-normal" variant="secondary">
    archived
  </Badge>
);

export const Byline = ({
  by,
  onSelect,
}: {
  by: Author | null;
  onSelect?: (by: Author) => void;
}) => {
  const personas = usePersonas();
  if (by === null) {
    return null;
  }
  const label = authorLabel(by, personas.data);
  if (!label) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1">
      by{" "}
      {onSelect ? (
        <button
          className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(by);
          }}
          title={`Show only changes by ${label.name}`}
          type="button"
        >
          {label.name}
        </button>
      ) : (
        label.name
      )}
      {label.archived ? <ArchivedBadge /> : null}
    </span>
  );
};

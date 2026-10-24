import { Ruler, TriangleAlert } from "lucide-react";

import { fragmentLength } from "@lib/fragment";

import { useSettings } from "../api/settings";

export const MemoryLength = ({
  always = false,
  text,
}: {
  always?: boolean;
  text: string;
}) => {
  const softLimit = useSettings().data?.settings.length.warn ?? null;
  const length = fragmentLength(text);
  if (softLimit !== null && length > softLimit) {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-700 tabular-nums dark:text-amber-400"
        title={`${length} characters, over your warning limit of ${softLimit}`}
      >
        <TriangleAlert aria-hidden="true" className="size-3" />
        {length}
      </span>
    );
  }
  if (!always) {
    return null;
  }
  return (
    <span
      className="inline-flex items-center gap-1 tabular-nums"
      title={`${length} characters`}
    >
      <Ruler aria-hidden="true" className="size-3" />
      {length}
    </span>
  );
};

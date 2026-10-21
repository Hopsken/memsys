import { useQuery } from "@tanstack/react-query";
import { Ruler, TriangleAlert } from "lucide-react";
import * as z from "zod/mini";

import { api } from "@/shared/api";
import type { PluginView } from "@contract/plugin";
import { fragmentLength } from "@lib/fragment";

const softLimitConfig = z.object({ soft: z.int() });

// The "Warn above" length from the Short memories plugin, or null when that
// plugin is off.
const useSoftLimit = () => {
  const plugins = useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/plugins", { signal }).json<PluginView[]>(),
    queryKey: ["plugins"],
  });
  const sizeLimit = plugins.data?.find(
    ({ enabled, name }) => enabled && name === "size-limit"
  );
  return z.safeParse(softLimitConfig, sizeLimit?.config).data?.soft ?? null;
};

// A memory's length, in amber when it is above the warning limit. Below the
// limit it shows only when `always` is set.
export const MemoryLength = ({
  always = false,
  text,
}: {
  always?: boolean;
  text: string;
}) => {
  const softLimit = useSoftLimit();
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

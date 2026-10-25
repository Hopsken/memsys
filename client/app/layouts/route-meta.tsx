import { Outlet, useMatches } from "react-router";
import { z } from "zod";

const routeMetaHandleSchema = z.object({
  meta: z.object({ title: z.string().optional() }),
});

// Renders head metadata from each route's `handle.meta`.
// Titles join deepest first: /settings/mcp → "MCP · Settings · memsys".
export const RouteMeta = () => {
  const metas = useMatches()
    .map((match) => routeMetaHandleSchema.safeParse(match.handle).data?.meta)
    .filter((meta) => meta !== undefined);

  const titles = metas
    .map((meta) => meta.title)
    .filter((title) => title !== undefined)
    .toReversed();

  return (
    <>
      <title>{[...titles, "memsys"].join(" · ")}</title>
      <Outlet />
    </>
  );
};

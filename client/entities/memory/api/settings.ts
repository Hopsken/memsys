import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { rpc } from "@/shared/api";

export const SETTINGS = ["settings"];

export const useSettings = () =>
  useQuery({
    queryFn: ({ signal }) =>
      parseResponse(rpc.settings.$get(undefined, { init: { signal } })),
    queryKey: SETTINGS,
  });

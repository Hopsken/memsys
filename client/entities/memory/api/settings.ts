import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api";
import type { SettingsView } from "@contract/settings";

export const SETTINGS = ["settings"];

export const useSettings = () =>
  useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/settings", { signal }).json<SettingsView>(),
    queryKey: SETTINGS,
  });

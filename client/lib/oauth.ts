import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { api } from "@/lib/api";

// The app an OAuth sign-in is for, while Better Auth's signed query is in
// the URL. It works before the user has a session.
export const useConnectingApp = () => {
  const [params] = useSearchParams();
  const clientId = params.get("client_id");
  const forApp = clientId !== null && params.has("sig");
  const app = useQuery({
    enabled: forApp,
    queryFn: ({ signal }) =>
      api
        .post("/api/auth/oauth2/public-client-prelogin", {
          json: {
            client_id: clientId,
            oauth_query: window.location.search.slice(1),
          },
          signal,
        })
        .json<{ client_name?: string }>(),
    queryKey: ["oauth-client", clientId],
    staleTime: Infinity,
  });
  return {
    forApp,
    isError: app.isError,
    isPending: forApp && app.isPending,
    name: app.data?.client_name ?? "an app",
  };
};

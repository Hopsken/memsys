import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { api } from "@/shared/api";

export const PERSONAS = ["personas"];
export const ASSIGNMENTS = ["persona-assignments"];

export const usePersonas = () =>
  useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.personas.$get(undefined, { init: { signal } })),
    queryKey: PERSONAS,
  });

export const useAssignments = () =>
  useQuery({
    queryFn: ({ signal }) =>
      parseResponse(
        api.personas.assignments.$get(undefined, { init: { signal } })
      ),
    queryKey: ASSIGNMENTS,
  });

export const useCreatePersona = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      parseResponse(api.personas.$post({ json: { name } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PERSONAS }),
  });
};

export const useAssignPersona = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (json: {
      connection: `apiKey:${string}` | `oauth:${string}`;
      personaId: string | null;
    }) => parseResponse(api.personas.assignments.$put({ json })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ASSIGNMENTS }),
        queryClient.invalidateQueries({ queryKey: PERSONAS }),
      ]),
  });
};

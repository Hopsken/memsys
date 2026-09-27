import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { failure } from "@/shared/api";
import { Toaster } from "@/shared/ui/toaster";

import { router } from "./router";

import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx answers, expired sessions included, will not change on retry.
      retry: (count, error) => {
        const { status } = failure(error);
        return count < 2 && (status === null || status >= 500);
      },
    },
  },
});

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Toaster>
          <RouterProvider router={router} />
        </Toaster>
      </QueryClientProvider>
    </StrictMode>
  );
}

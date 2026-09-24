import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { failure } from "@/lib/api";

import { App } from "./app";
import { FragmentsView } from "./fragments";
import { PluginsView } from "./plugins";

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

const router = createBrowserRouter([
  {
    children: [
      { element: <FragmentsView />, index: true },
      { element: <PluginsView />, path: "plugins" },
      { element: <Navigate replace to="/" />, path: "*" },
    ],
    element: <App />,
  },
]);

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
}

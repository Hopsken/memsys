import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { failure } from "@/lib/api";

import { App } from "./app";
import { FragmentsView } from "./fragments";
import { LoginView } from "./login";
import { PluginsView } from "./plugins";
import { TokensView } from "./tokens";

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
  { element: <LoginView />, path: "/login" },
  {
    // App sends visitors without a session to /login.
    children: [
      { element: <FragmentsView />, index: true },
      { element: <PluginsView />, path: "plugins" },
      { element: <TokensView />, path: "tokens" },
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

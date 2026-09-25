import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { failure } from "@/lib/api";

import { ApiKeysView } from "./api-keys";
import { App } from "./app";
import { ConsentView } from "./consent";
import { DataView } from "./data";
import { FragmentsView } from "./fragments";
import { LoginView } from "./login";
import { PluginsView } from "./plugins";
import { AccountView, SettingsView } from "./settings";

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
  { element: <ConsentView />, path: "/consent" },
  {
    // App sends visitors without a session to /login.
    children: [
      { element: <FragmentsView />, index: true },
      {
        children: [
          { element: <Navigate replace to="mcp" />, index: true },
          { element: <ApiKeysView />, path: "mcp" },
          { element: <PluginsView />, path: "plugins" },
          { element: <DataView />, path: "data" },
          { element: <AccountView />, path: "account" },
        ],
        element: <SettingsView />,
        path: "settings",
      },
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

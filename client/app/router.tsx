import { createBrowserRouter, Navigate } from "react-router";

import { ConsentView } from "@/pages/consent";
import { ForgottenView } from "@/pages/forgotten";
import { LoginView } from "@/pages/login";
import { FragmentsView } from "@/pages/memories";
import { AccountView } from "@/pages/settings/account";
import { DataView } from "@/pages/settings/data";
import { ApiKeysView } from "@/pages/settings/mcp";
import { PluginsView } from "@/pages/settings/plugins";
import { HistoryDialog } from "@/widgets/memory-history";

import { App } from "./layouts/app-layout";
import { SettingsView } from "./layouts/settings-layout";

export const router = createBrowserRouter([
  { element: <LoginView />, path: "/login" },
  { element: <ConsentView />, path: "/consent" },
  {
    // App sends visitors without a session to /login.
    children: [
      // History opens as a dialog over the list that links to it.
      {
        children: [{ element: <HistoryDialog />, path: "memories/:ref" }],
        element: <FragmentsView />,
        path: "/",
      },
      {
        children: [{ element: <HistoryDialog />, path: ":ref" }],
        element: <ForgottenView />,
        path: "forgotten",
      },
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

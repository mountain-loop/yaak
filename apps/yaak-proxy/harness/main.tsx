import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyThemeToDocument, defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme";
import { createStore, Provider } from "jotai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FlowPanesHarness } from "./FlowPanesHarness";
import { installLockedBackend, LockedHarness } from "./LockedHarness";
import { MessagesHarness } from "./MessagesHarness";
import "../main.css";

const params = new URLSearchParams(location.search);
const dark = params.get("theme") !== "light";
applyThemeToDocument(dark ? defaultDarkTheme : defaultLightTheme);
if (params.has("locked")) installLockedBackend();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={createStore()}>
        {params.has("locked") ? (
          <LockedHarness />
        ) : params.has("stream") ? (
          <MessagesHarness />
        ) : (
          <FlowPanesHarness />
        )}
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

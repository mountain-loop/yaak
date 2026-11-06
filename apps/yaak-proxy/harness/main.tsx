import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyThemeToDocument, defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme";
import { createStore, Provider } from "jotai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FlowPanesHarness } from "./FlowPanesHarness";
import "../main.css";

const dark = new URLSearchParams(location.search).get("theme") !== "light";
applyThemeToDocument(dark ? defaultDarkTheme : defaultLightTheme);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={createStore()}>
        <FlowPanesHarness />
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyThemeToDocument, defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme";
import { createStore, Provider } from "jotai";
import { LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installFixtureBackend } from "./backend";
import { FlowPanesHarness } from "./FlowPanesHarness";
import { installLockedBackend, LockedHarness } from "./LockedHarness";
import { MessagesHarness } from "./MessagesHarness";
import { SettingsHarness } from "./SettingsHarness";
import "../main.css";

const params = new URLSearchParams(location.search);
// As the app loads them, so dialogs fade in
const motionFeatures = () => import("framer-motion").then((mod) => mod.domAnimation);
const dark = params.get("theme") !== "light";
applyThemeToDocument(dark ? defaultDarkTheme : defaultLightTheme);
if (params.has("locked")) installLockedBackend();
else installFixtureBackend();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={createStore()}>
        <LazyMotion strict features={motionFeatures}>
          <MotionConfig transition={{ duration: 0.1 }}>
            {params.has("locked") || params.has("window") ? (
              <LockedHarness />
            ) : params.has("settings") ? (
              <SettingsHarness />
            ) : params.has("stream") ? (
              <MessagesHarness />
            ) : (
              <FlowPanesHarness />
            )}
          </MotionConfig>
        </LazyMotion>
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { LazyMotion, MotionConfig } from "motion/react";
import { HotkeyProvider } from "@yaakapp-internal/ui";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProxyLayout } from "./components/ProxyLayout";
import { SettingsWindowContent } from "./components/Settings";
import { useHotkeyContextValue } from "./lib/hotkeys";
import { syncSettingsValues } from "./lib/interfaceSettings";
import { syncNavigation, syncSidebarSelection } from "./lib/navigation";
import { syncFlows, syncProxyState } from "./lib/store";
import { currentWindowLabel } from "./lib/tauri";
import { syncFromOtherWindows } from "./lib/windowSync";
import { windowKind } from "./lib/windows";
import "./main.css";

const queryClient = new QueryClient();
const jotaiStore = createStore();
// Each window's page is the same; its label says which part of the app it holds
const settingsWindow = windowKind(currentWindowLabel()) === "settings";

syncProxyState(jotaiStore);
syncSettingsValues(jotaiStore);
syncFromOtherWindows(jotaiStore, queryClient);
// Only the app's window lists traffic and navigates it
if (!settingsWindow) {
  // Before the flows load, so they load for the filter it restores
  await syncNavigation(jotaiStore);
  syncFlows(jotaiStore);
  syncSidebarSelection(jotaiStore);
}

function Hotkeys({ children }: { children: ReactNode }) {
  return <HotkeyProvider value={useHotkeyContextValue()}>{children}</HotkeyProvider>;
}

const motionFeatures = () => import("framer-motion").then((mod) => mod.domAnimation);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={jotaiStore}>
        <LazyMotion strict features={motionFeatures}>
          <MotionConfig transition={{ duration: 0.1 }}>
            {settingsWindow ? (
              // The app's hotkeys act on traffic, and their confirmations live in its window
              <SettingsWindowContent />
            ) : (
              <Hotkeys>
                <ProxyLayout />
              </Hotkeys>
            )}
          </MotionConfig>
        </LazyMotion>
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { LazyMotion, MotionConfig } from "motion/react";
import { HotkeyProvider } from "@yaakapp-internal/ui";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProxyLayout } from "./components/ProxyLayout";
import { useHotkeyContextValue } from "./lib/hotkeys";
import { syncFlows } from "./lib/store";
import "./main.css";

const queryClient = new QueryClient();
const jotaiStore = createStore();

syncFlows(jotaiStore);

function Hotkeys({ children }: { children: ReactNode }) {
  return <HotkeyProvider value={useHotkeyContextValue()}>{children}</HotkeyProvider>;
}

const motionFeatures = () => import("framer-motion").then((mod) => mod.domAnimation);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={jotaiStore}>
        <Hotkeys>
          <LazyMotion strict features={motionFeatures}>
            <MotionConfig transition={{ duration: 0.1 }}>
              <ProxyLayout />
            </MotionConfig>
          </LazyMotion>
        </Hotkeys>
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

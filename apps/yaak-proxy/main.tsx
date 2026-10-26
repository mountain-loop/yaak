import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { LazyMotion, MotionConfig } from "motion/react";
import { HotkeyProvider } from "@yaakapp-internal/ui";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProxyLayout } from "./components/ProxyLayout";
import { useHotkeyContextValue } from "./lib/hotkeys";
import { listen, rpc } from "./lib/rpc";
import { applyChange, dataAtom, replaceAll } from "./lib/store";
import "./main.css";

const queryClient = new QueryClient();
const jotaiStore = createStore();

// Load initial models from the database
void rpc("list_models", {}).then((res) => {
  jotaiStore.set(dataAtom, (prev) => replaceAll(prev, "flow", res.flows));
});

// Subscribe to model change events from the backend
void listen("model_write", (payload) => {
  jotaiStore.set(dataAtom, (prev) => applyChange(prev, "flow", payload.model, payload.change));
});

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

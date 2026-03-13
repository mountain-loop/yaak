import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProxyLayout } from "./components/ProxyLayout";
import { listen, rpc } from "./lib/rpc";
import { initHotkeys } from "./lib/hotkeys";
import { applyChange, dataAtom, replaceAll } from "./lib/store";
import "./main.css";

const queryClient = new QueryClient();
const jotaiStore = createStore();

// Load initial models from the database
void rpc("list_models", {}).then((res) => {
  jotaiStore.set(dataAtom, (prev) => replaceAll(prev, "http_exchange", res.httpExchanges));
});

// Register hotkeys from action metadata
void initHotkeys();

// Subscribe to model change events from the backend
void listen("model_write", (payload) => {
  jotaiStore.set(dataAtom, (prev) =>
    applyChange(prev, "http_exchange", payload.model, payload.change),
  );
});

const motionFeatures = () => import("framer-motion").then((mod) => mod.domAnimation);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={jotaiStore}>
        <LazyMotion strict features={motionFeatures}>
          <MotionConfig transition={{ duration: 0.1 }}>
            <ProxyLayout />
          </MotionConfig>
        </LazyMotion>
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

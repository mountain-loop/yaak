import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type } from "@tauri-apps/plugin-os";
import { HeaderSize } from "@yaakapp-internal/ui";
import { ActionButton } from "./ActionButton";
import { Sidebar } from "./Sidebar";
import classNames from "classnames";
import { createStore, Provider, useAtomValue } from "jotai";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./main.css";
import { initHotkeys } from "./hotkeys";
import { listen, rpc } from "./rpc";
import { applyChange, dataAtom, httpExchangesAtom, replaceAll } from "./store";

const queryClient = new QueryClient();
const jotaiStore = createStore();

// Load initial models from the database
rpc("list_models", {}).then((res) => {
  jotaiStore.set(dataAtom, (prev) =>
    replaceAll(prev, "http_exchange", res.httpExchanges),
  );
});

// Register hotkeys from action metadata
initHotkeys();

// Subscribe to model change events from the backend
listen("model_write", (payload) => {
  jotaiStore.set(dataAtom, (prev) =>
    applyChange(prev, "http_exchange", payload.model, payload.change),
  );
});

function App() {
  const osType = type();
  const exchanges = useAtomValue(httpExchangesAtom);

  return (
    <div
      className={classNames(
        "h-full w-full grid grid-rows-[auto_1fr]",
        osType === "linux" && "border border-border-subtle",
      )}
    >
      <HeaderSize
        size="lg"
        osType={osType}
        hideWindowControls={false}
        useNativeTitlebar={false}
        interfaceScale={1}
        className="x-theme-appHeader bg-surface"
      >
        <div
          data-tauri-drag-region
          className="flex items-center px-2 text-sm font-semibold text-text-subtle"
        >
          Yaak Proxy
        </div>
      </HeaderSize>
      <div className="grid grid-cols-[auto_1fr] min-h-0">
        <Sidebar />
        <main className="overflow-auto p-4">
          <div className="flex items-center gap-3 mb-4">
            <ActionButton
              action={{ scope: "global", action: "proxy_start" }}
              size="sm"
              tone="primary"
            />
            <ActionButton
              action={{ scope: "global", action: "proxy_stop" }}
              size="sm"
              variant="border"
            />
          </div>

          <div className="text-xs font-mono">
            {exchanges.length === 0 ? (
              <p className="text-text-subtlest">No traffic yet</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="text-text-subtlest border-b border-border-subtle">
                    <th className="py-1 pr-3 font-medium">Method</th>
                    <th className="py-1 pr-3 font-medium">URL</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {exchanges.map((ex) => (
                    <tr key={ex.id} className="border-b border-border-subtle">
                      <td className="py-1 pr-3">{ex.method}</td>
                      <td className="py-1 pr-3 truncate max-w-md">{ex.url}</td>
                      <td className="py-1 pr-3">{ex.resStatus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={jotaiStore}>
        <App />
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);

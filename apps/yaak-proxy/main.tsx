import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type } from "@tauri-apps/plugin-os";
import { Button, HeaderSize } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { createStore, Provider, useAtomValue } from "jotai";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./main.css";
import { listen, rpc } from "./rpc";
import { applyChange, dataAtom, httpExchangesAtom } from "./store";

const queryClient = new QueryClient();
const jotaiStore = createStore();

// Subscribe to model change events from the backend
listen("model_write", (payload) => {
  jotaiStore.set(dataAtom, (prev) =>
    applyChange(prev, "http_exchange", payload.model, payload.change),
  );
});

function App() {
  const [status, setStatus] = useState("Idle");
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const osType = type();
  const exchanges = useAtomValue(httpExchangesAtom);

  async function startProxy() {
    setBusy(true);
    setStatus("Starting...");
    try {
      const result = await rpc("proxy_start", { port: 9090 });
      setPort(result.port);
      setStatus(result.alreadyRunning ? "Already running" : "Running");
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopProxy() {
    setBusy(true);
    setStatus("Stopping...");
    try {
      const stopped = await rpc("proxy_stop", {});
      setPort(null);
      setStatus(stopped ? "Stopped" : "Not running");
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

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
      <main className="overflow-auto p-4">
        <div className="flex items-center gap-3 mb-4">
          <Button disabled={busy} onClick={startProxy} size="sm" tone="primary">
            Start Proxy
          </Button>
          <Button
            disabled={busy}
            onClick={stopProxy}
            size="sm"
            variant="border"
          >
            Stop Proxy
          </Button>
          <span className="text-xs text-text-subtlest">
            {status}
            {port != null && ` · :${port}`}
          </span>
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

import "./main.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type } from "@tauri-apps/plugin-os";
import { Button, HeaderSize } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { StrictMode } from "react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { rpc } from "./rpc";

const queryClient = new QueryClient();

function App() {
  const [status, setStatus] = useState("Idle");
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const osType = type();

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
    <div className={classNames('h-full w-full grid grid-rows-[auto_1fr]', osType === 'linux' && 'border border-border-subtle')}>
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
          className="flex items-center h-full px-2 text-sm font-semibold text-text-subtle"
        >
          Yaak Proxy
        </div>
      </HeaderSize>
      <main className="overflow-auto p-6">
        <section className="flex items-start">
          <div className="flex w-full max-w-xl flex-col gap-4">
            <div>
              <p className="text-sm text-text-subtle">Status: {status}</p>
              <p className="mt-1 text-sm text-text-subtle">
                Port: {port ?? "Not running"}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy}
                onClick={startProxy}
                size="sm"
                tone="primary"
              >
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
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

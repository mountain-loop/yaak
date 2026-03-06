import "./main.css";
import { Button } from "@yaakapp-internal/ui";
import { invoke } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

type ProxyStartResult = {
  port: number;
  alreadyRunning: boolean;
};

function App() {
  const [status, setStatus] = useState("Idle");
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function startProxy() {
    setBusy(true);
    setStatus("Starting...");
    try {
      const result = await invoke<ProxyStartResult>("proxy_start", {
        port: 9090,
      });
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
      const stopped = await invoke<boolean>("proxy_stop");
      setPort(null);
      setStatus(stopped ? "Stopped" : "Not running");
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="h-full w-full overflow-auto p-6">
      <section className="flex items-start">
        <div className="flex w-full max-w-xl flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text">Yaak Proxy</h1>
            <p className="mt-2 text-sm text-text-subtle">Status: {status}</p>
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
            <Button size="sm" type="button">
              Shared Button
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

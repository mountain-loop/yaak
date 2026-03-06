import "./main.css";
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
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Monorepo Smoke Test</p>
        <h1>Yaak Proxy</h1>
        <p className="lede">
          This is a minimal proxy app stub running on the new `apps/yaak-proxy`
          and `crates-tauri/yaak-app-proxy` structure.
        </p>
        <div className="controls">
          <button className="btn" disabled={busy} onClick={startProxy}>
            Start Proxy
          </button>
          <button className="btn ghost" disabled={busy} onClick={stopProxy}>
            Stop Proxy
          </button>
        </div>
        <div className="status">
          <span>Status: {status}</span>
          {port != null ? <span>Port: {port}</span> : null}
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

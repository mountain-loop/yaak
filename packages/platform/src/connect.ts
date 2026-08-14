/**
 * Deciding which host to install, and getting a bridge token when there isn't
 * one yet.
 *
 * Dev-grade on purpose. The token is a shared secret the bridge prints at
 * startup, passed in the URL and kept for the session. OTP pairing and request
 * encryption replace this whole file; the seam is that nothing outside it knows
 * how the token was obtained.
 */

export interface BridgeConfig {
  url: string;
  token: string;
}

const TOKEN_STORAGE_KEY = "yaak.bridge.token";
const TOKEN_QUERY_PARAM = "bridgeToken";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }

  // Declared here rather than by depending on Vite's types: this package is
  // consumed by a bundler that provides them, and only this one variable.
  interface ImportMeta {
    readonly env?: Record<string, string | undefined>;
  }
}

function bridgeUrl(): string {
  // Set when the frontend runs on a Vite dev server and the bridge is on its
  // own port. When the bridge serves the built app, they share an origin.
  const configured = import.meta.env?.VITE_YAAK_BRIDGE_URL;
  return (configured ?? window.location.origin).replace(/\/$/, "");
}

/**
 * The bridge token, or null if the user hasn't supplied one.
 *
 * A token in the URL is consumed and stashed: leaving it in the address bar
 * means it lands in the router's own history entries and in anything the user
 * copies out of the bar.
 */
function readToken(): string | null {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get(TOKEN_QUERY_PARAM);

  if (fromQuery != null && fromQuery !== "") {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fromQuery);
    url.searchParams.delete(TOKEN_QUERY_PARAM);
    history.replaceState(null, "", url.toString());
    return fromQuery;
  }

  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

/** Whether this build should talk to a bridge at all. */
export function shouldUseBridge(): boolean {
  if (typeof window === "undefined") return false;
  // Running inside the desktop app: Tauri always wins.
  if (window.__TAURI_INTERNALS__ != null) return false;
  return true;
}

export function bridgeConfig(): BridgeConfig | null {
  const token = readToken();
  if (token == null) return null;
  return { url: bridgeUrl(), token };
}

/**
 * Put the connect form on screen.
 *
 * Synchronous, and it does not stop anything by itself — the caller pairs it
 * with a host that never connects, so the app's own boot-time await is what
 * holds. Submitting reloads with the token in the query, which `readToken`
 * then consumes.
 */
export function promptForToken(): void {
  document.body.innerHTML = `
    <div style="font-family: system-ui, sans-serif; max-width: 26rem; margin: 15vh auto; padding: 0 1.5rem; color: #d5d3e0">
      <h1 style="font-size: 1.25rem; margin: 0 0 0.5rem">Connect to the Yaak Bridge</h1>
      <p style="margin: 0 0 1.25rem; line-height: 1.5; color: #9a97ad">
        Paste the token the bridge printed when it started.
      </p>
      <form id="yaak-bridge-connect" style="display: flex; gap: 0.5rem">
        <input name="token" autofocus autocomplete="off" spellcheck="false" placeholder="Bridge token"
          style="flex: 1; padding: 0.5rem 0.65rem; border-radius: 0.375rem; border: 1px solid #3b3950; background: #232135; color: inherit; font-family: ui-monospace, monospace" />
        <button type="submit"
          style="padding: 0.5rem 1rem; border-radius: 0.375rem; border: 0; background: #6d5ef0; color: white; font-weight: 500; cursor: pointer">
          Connect
        </button>
      </form>
    </div>
  `;
  document.documentElement.style.background = "#1b1a29";

  document.getElementById("yaak-bridge-connect")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = new FormData(e.target as HTMLFormElement).get("token");
    if (typeof token !== "string" || token === "") return;
    const url = new URL(window.location.href);
    url.searchParams.set(TOKEN_QUERY_PARAM, token);
    window.location.href = url.toString();
  });
}

import { platform } from "@yaakapp-internal/platform";
import { InlineCode } from "@yaakapp-internal/ui";
import { Link } from "../components/core/Link";
import { showConfirm } from "./confirm";

const acceptedProxies = new Set<string>();
const pendingConfirmations = new Map<string, Promise<boolean>>();

/** One decision for all pending sends; only acceptance is remembered. */
export function confirmWebProxy(): Promise<boolean> {
  const proxyUrl = platform.httpProxyUrl;
  if (proxyUrl == null) return Promise.resolve(true);

  const key = `yaak.webProxyConsent.v1:${proxyUrl}`;
  try {
    if (localStorage.getItem(key) === "accepted") return Promise.resolve(true);
  } catch {
    // Storage can be unavailable in private or restricted browsing.
  }
  if (acceptedProxies.has(proxyUrl)) return Promise.resolve(true);

  const pending = pendingConfirmations.get(proxyUrl);
  if (pending != null) return pending;

  const confirmation = showConfirm({
    id: "web-proxy-consent",
    title: "Requests in Yaak Web use a proxy",
    confirmText: "Send via Proxy",
    description: (
      <div className="space-y-3">
        <p>
          Yaak Web sends requests through a hosted proxy. Request and response data, including
          credentials, pass through the server shown below.
        </p>
        <p>
          <InlineCode className="break-all">{proxyUrl}</InlineCode>
        </p>
        <p>
          Learn more about{" "}
          <Link href="https://yaak.app/docs/getting-started/web-proxy">how the proxy works</Link>.
        </p>
      </div>
    ),
  })
    .then((accepted) => {
      if (accepted) {
        acceptedProxies.add(proxyUrl);
        try {
          localStorage.setItem(key, "accepted");
        } catch {
          // Keep acceptance for this tab if it cannot be persisted.
        }
      }
      return accepted;
    })
    .finally(() => pendingConfirmations.delete(proxyUrl));

  pendingConfirmations.set(proxyUrl, confirmation);
  return confirmation;
}

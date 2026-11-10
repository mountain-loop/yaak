import type { DecryptListEntry, Flow } from "@yaakapp-internal/proxy-lib";
import { fixtures } from "./fixtures";

/**
 * Dev only: traffic for HTTPS decryption's states, by `?scene=`: `encrypted`, the first minute
 * with nothing decrypted, and `mixed`, some decrypted, a refused handshake and the tunnel passed
 * through after it.
 */
export type HttpsScene = "encrypted" | "mixed";

export const BUILT_IN_EXCLUSIONS: DecryptListEntry[] = [
  { entry: "!host:*.apple.com", builtIn: true, kind: "apple" },
  { entry: "!host:*.icloud.com", builtIn: true, kind: "apple" },
  { entry: "!host:*.mzstatic.com", builtIn: true, kind: "apple" },
  { entry: "!host:*.1password.com", builtIn: true, kind: "pinned" },
  { entry: "!host:*.dropbox.com", builtIn: true, kind: "pinned" },
];

const template = fixtures[0]?.flow as Flow;
const start = Date.parse("2026-11-09T09:00:00Z");

const apps = {
  dia: {
    clientName: "Dia",
    clientBundleId: "company.thebrowser.dia",
    clientPath: "/Applications/Dia.app",
  },
  chrome: {
    clientName: "Google Chrome",
    clientBundleId: "com.google.Chrome",
    clientPath: "/Applications/Google Chrome.app",
  },
  slack: {
    clientName: "Slack",
    clientBundleId: "com.tinyspeck.slackmacgap",
    clientPath: "/Applications/Slack.app",
  },
  onePassword: {
    clientName: "1Password",
    clientBundleId: "com.1password.1password",
    clientPath: "/Applications/1Password.app",
  },
  headless: {
    clientName: "chrome-headless-shell",
    clientBundleId: null,
    clientPath:
      "/Users/you/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell",
  },
  acme: {
    clientName: "Acme Sync",
    clientBundleId: "dev.acme.sync",
    clientPath: "/Applications/Acme Sync.app",
  },
  cloudd: {
    clientName: "cloudd",
    clientBundleId: null,
    clientPath: "/System/Library/PrivateFrameworks/CloudKitDaemon.framework/Support/cloudd",
  },
} as const;

type App = (typeof apps)[keyof typeof apps];

function tunnel(i: number, host: string, app: App, over: Partial<Flow> = {}): Flow {
  return {
    ...template,
    ...app,
    id: `fl_https_${i}`,
    method: "CONNECT",
    url: `${host}:443`,
    startedAt: new Date(start + i * 1100).toISOString().replace("Z", ""),
    status: null,
    contentType: null,
    requestHeaders: [],
    responseHeaders: [],
    elapsedHeadersMs: null,
    elapsedConnectMs: null,
    elapsedTlsMs: null,
    elapsedRequestMs: null,
    elapsedMs: 120 + ((i * 97) % 900),
    clientHttpVersion: "HTTP/1.1",
    upstreamHttpVersion: null,
    upstreamTlsVersion: null,
    upstreamTlsCipher: null,
    requestSize: 600 + ((i * 331) % 3000),
    responseSize: 1_200 + ((i * 7919) % 120_000),
    tunnelled: true,
    tunnelReason: "not_listed",
    ...over,
    // An open tunnel has been open a little while, counting up from now
    ...(over.elapsedMs === null
      ? { startedAt: new Date(Date.now() - 22_000 - i * 1000).toISOString().replace("Z", "") }
      : {}),
  };
}

function decrypted(i: number, source: number, url: string, app: App): Flow {
  const flow = fixtures[source]?.flow ?? template;
  return {
    ...flow,
    ...app,
    // The fixture's id first, so the backend finds its bodies
    id: `${flow.id}~https_${i}`,
    url,
    startedAt: new Date(start + i * 1100).toISOString().replace("Z", ""),
  };
}

const builtInExcluded = {
  tunnelReason: "excluded" as const,
  tunnelExcludedBy: "!host:*.1password.com",
  tunnelExcludedBuiltIn: true,
};

/** The first minute: every HTTPS connection encrypted, two still open */
function encryptedScene(): Flow[] {
  return [
    tunnel(1, "clientstream.launchdarkly.com", apps.dia, { elapsedMs: null }),
    tunnel(2, "browser-intake-datadoghq.com", apps.dia),
    tunnel(3, "api.typefully.com", apps.dia),
    tunnel(4, "js.stripe.com", apps.dia),
    tunnel(5, "edgeapi.slack.com", apps.slack),
    tunnel(6, "wss-primary.slack.com", apps.slack, { elapsedMs: null }),
    tunnel(7, "gateway.icloud.com", apps.cloudd, {
      tunnelReason: "excluded",
      tunnelExcludedBy: "!host:*.icloud.com",
      tunnelExcludedBuiltIn: true,
    }),
    tunnel(8, "my.1password.com", apps.onePassword, builtInExcluded),
    tunnel(9, "www.google.com", apps.dia),
    tunnel(10, "fonts.gstatic.com", apps.dia),
    tunnel(11, "clients2.google.com", apps.chrome),
    tunnel(12, "home.taila714c.ts.net:8317", apps.dia, { url: "home.taila714c.ts.net:8317" }),
    tunnel(13, "optimizationguide-pa.googleapis.com", apps.headless),
  ];
}

/**
 * Some decrypted, a refused handshake from an app that pins, and the tunnel passed through
 * after it
 */
function mixedScene(): Flow[] {
  return [
    tunnel(1, "my.1password.com", apps.onePassword, builtInExcluded),
    decrypted(2, 0, "https://api.stripe.com/v1/payment_intents", apps.dia),
    decrypted(3, 5, "https://api.github.com/graphql", apps.chrome),
    tunnel(4, "edgeapi.slack.com", apps.slack),
    decrypted(5, 2, "https://cdn.example.com/avatars/42.png?size=2", apps.dia),
    tunnel(6, "gateway.icloud.com", apps.cloudd, {
      tunnelReason: "excluded",
      tunnelExcludedBy: "!host:*.icloud.com",
      tunnelExcludedBuiltIn: true,
    }),
    {
      ...tunnel(7, "sync.acme.dev", apps.acme),
      method: "",
      url: "https://sync.acme.dev",
      tunnelled: false,
      tunnelReason: null,
      tlsRejected: "bad_certificate",
      error: "Rejected the proxy's certificate",
      elapsedMs: 6,
      requestSize: 517,
      responseSize: 0,
    },
    tunnel(8, "sync.acme.dev", apps.acme, {
      tunnelReason: "rejected",
      tunnelRejectedBy: "fl_https_7",
      elapsedMs: null,
    }),
    decrypted(9, 0, "https://api.typefully.com/v1/drafts", apps.dia),
    tunnel(10, "www.google.com", apps.dia, { elapsedMs: null }),
  ];
}

export function httpsFlows(scene: string | null): Flow[] | null {
  if (scene === "encrypted") return encryptedScene();
  if (scene === "mixed") return mixedScene();
  return null;
}

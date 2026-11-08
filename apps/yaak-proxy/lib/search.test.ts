import type { Flow } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { appKeyOf, isSystemFlow, sidebarPath, siteOf } from "./search";

describe("sidebarPath", () => {
  // The cases `sidebar_path_rules` in `flows.rs` checks, so the two agree.
  test("is the lowercased host without its default port, then the non-empty segments", () => {
    for (const [url, path] of [
      ["https://example.com/v1//users", "example.com/v1/users"],
      ["http://x.com:80/a", "x.com/a"],
      ["https://x.com:443/a?q=1#f", "x.com/a"],
      ["http://x.com:443/a", "x.com:443/a"],
      ["https://API.Stripe.com:8443/", "api.stripe.com:8443"],
      ["https://api.stripe.com", "api.stripe.com"],
      ["https://api.stripe.com?x=/y", "api.stripe.com"],
      ["http://[::1]:80/a/B", "[::1]/a/B"],
      ["/api", "/api"],
    ]) {
      expect(sidebarPath(url ?? ""), url).toBe(path);
    }
  });
});

describe("isSystemFlow", () => {
  // The cases `tells_system_daemons_apart` in `flows.rs` checks, so the two agree.
  test("is a daemon outside an app, under the system's folders or by name", () => {
    const sys = (clientPath: string | null, clientBundleId: string | null = null) =>
      isSystemFlow({ clientPath, clientBundleId });
    expect(sys("/usr/libexec/nsurlsessiond")).toBe(true);
    expect(sys("/System/Library/PrivateFrameworks/X.framework/geod")).toBe(true);
    expect(sys("/somewhere/else/trustd")).toBe(true);
    expect(sys("/usr/bin/curl")).toBe(false);
    expect(sys("/opt/homebrew/bin/node")).toBe(false);
    expect(sys("/System/Applications/Music.app", "com.apple.Music")).toBe(false);
    expect(
      sys(
        "/System/Library/Frameworks/WebKit.framework/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking",
      ),
    ).toBe(false);
    expect(sys(null)).toBe(false);
  });
});

describe("siteOf", () => {
  test("is the registrable domain, or the host itself without one", () => {
    expect(siteOf("api.github.com")).toBe("github.com");
    expect(siteOf("www.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("api.stripe.com:8443")).toBe("stripe.com");
    expect(siteOf("localhost:3000")).toBe("localhost");
    expect(siteOf("149.154.175.50")).toBe("149.154.175.50");
  });
});

describe("appKeyOf", () => {
  test("names an app, a program, or a runtime by the folder it ran in", () => {
    const flow = (extra: Partial<Flow>) =>
      ({
        clientName: null,
        clientBundleId: null,
        clientPath: null,
        clientCwd: null,
        ...extra,
      }) as Flow;
    const flows = [
      flow({ clientName: "Slack", clientBundleId: "com.tinyspeck.slackmacgap" }),
      flow({
        clientName: "node",
        clientPath: "/opt/homebrew/bin/node",
        clientCwd: "/src/fieldwork",
      }),
      flow({
        clientName: "nsurlsessiond",
        clientPath: "/usr/libexec/nsurlsessiond",
        clientCwd: "/",
      }),
      flow({}),
    ];
    expect(flows.map(appKeyOf)).toEqual(["Slack", "fieldwork", "nsurlsessiond", null]);
  });
});

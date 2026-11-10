import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import type { HostEditorProps } from "../EditorHost";
import { EditorHostProvider } from "../EditorHost";
import { SettingsDialog } from "./SettingsDialog";
import { SettingsGeneral } from "./SettingsGeneral";
import { SettingsInterface } from "./SettingsInterface";
import { SettingsLicense } from "./SettingsLicense";
import { SettingsPage } from "./SettingsPage";
import { SettingsTheme } from "./SettingsTheme";
import type { SettingsCallbacks, SettingsLicenseStatus, SettingsView } from "./types";

// Outside the app there's no Tauri; on macOS the selects are native, which shows their values
vi.mock("@yaakapp-internal/platform", () => ({ platform: { osType: () => "macos" } }));

function StubEditor({ defaultValue }: HostEditorProps) {
  return <div data-editor>{defaultValue}</div>;
}

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <EditorHostProvider value={{ Editor: StubEditor }}>{node}</EditorHostProvider>,
  );
}

/** Text only, so assertions read like the screen */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const light = { id: "yaak-light", label: "Yaak", dark: false };
const dark = { id: "yaak-dark", label: "Yaak", dark: true };
const hotdog = { id: "hotdog", label: "Hotdog Stand", dark: false };

function stubView(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    app: {
      name: "Yaak Proxy",
      version: "2026.11.0",
      dataDir: "/data/app.yaak.proxy",
      logDir: "/logs/app.yaak.proxy",
      revealPathLabel: "Reveal in Finder",
    },
    values: {
      appearance: "system",
      themeLight: "missing-theme",
      themeDark: "yaak-dark",
      interfaceFont: null,
      interfaceFontSize: 15,
      editorFont: "Menlo",
      editorFontSize: 13,
      editorKeymap: "vim",
      editorSoftWrap: true,
      coloredMethods: false,
      useNativeTitlebar: false,
      hideWindowControls: false,
      updateChannel: "beta",
      autoupdate: false,
      autoDownloadUpdates: true,
      checkNotifications: true,
      promptFeedback: true,
    },
    themes: {
      themes: [dark, light, hotdog],
      light: hotdog,
      dark,
      active: hotdog,
      resolvedAppearance: "light",
    },
    fonts: { uiFonts: ["Inter"], editorFonts: ["Menlo"] },
    windowControlsSetting: false,
    updates: { checking: false },
    feedbackPrompts: false,
    license: {
      pending: false,
      status: null,
      checkError: null,
      activateError: null,
      activating: false,
    },
    ...overrides,
  };
}

const callbacks: SettingsCallbacks = {
  onChange: () => {},
  onApplyNativeTitlebar: () => {},
  onCheckForUpdates: () => {},
  onActivateLicense: async () => {},
  onDeactivateLicense: () => {},
  onOpenUrl: () => {},
  onRevealPath: () => {},
  pricingUrl: (intent) => `https://yaak.app/pricing?intent=${intent}`,
};

describe("SettingsGeneral", () => {
  test("reads the app's name, version and paths, and the update values", () => {
    const html = render(<SettingsGeneral view={stubView()} callbacks={callbacks} />);
    const t = text(html);
    expect(t).toContain("Choose whether Yaak Proxy should use stable releases or beta releases.");
    expect(t).toContain("Download Yaak Proxy updates in the background");
    expect(t).toContain("Current Yaak Proxy version. 2026.11.0");
    expect(t).toContain("/data/app.yaak.proxy");
    expect(t).toContain("/logs/app.yaak.proxy");
    expect(html).toContain('title="Reveal in Finder"');
    // The channel select shows the value it was given
    expect(html).toMatch(/<option value="beta" selected="">Beta<\/option>/);
    // Manual updates leave the auto-download row disabled
    expect(html).toMatch(
      /aria-disabled="true"[^>]*>(?:(?!aria-disabled).)*Automatically download/s,
    );
  });

  test("leaves out Updates without an updater, and shows Feedback only when asked", () => {
    const without = text(
      render(<SettingsGeneral view={stubView({ updates: null })} callbacks={callbacks} />),
    );
    expect(without).not.toContain("Update Channel");
    expect(without).not.toContain("Prompt for feedback");

    const withFeedback = text(
      render(<SettingsGeneral view={stubView({ feedbackPrompts: true })} callbacks={callbacks} />),
    );
    expect(withFeedback).toContain("Prompt for feedback");
  });

  test("puts the app's banner under the heading and its own sections before App Info", () => {
    const t = text(
      render(
        <SettingsGeneral
          view={stubView()}
          callbacks={callbacks}
          banner={<p>Banner slot</p>}
          extraSections={<p>Extra section</p>}
        />,
      ),
    );
    expect(t.indexOf("Banner slot")).toBeLessThan(t.indexOf("Updates"));
    expect(t.indexOf("Extra section")).toBeGreaterThan(t.indexOf("Send anonymous"));
    expect(t.indexOf("Extra section")).toBeLessThan(t.indexOf("App Info"));
  });
});

describe("SettingsPage", () => {
  function NoBanner() {
    return null;
  }

  test("puts a banner between the header and the content, each the same gap apart", () => {
    const html = render(
      <SettingsPage title="General" description="About it" banner={<p>Banner</p>}>
        <p>Content</p>
      </SettingsPage>,
    );
    expect(html).toMatch(/<div class="mt-6 [^"]*:hidden"><p>Banner<\/p><\/div>/);
    expect(html).toContain('<div class="mt-6"><p>Content</p></div>');
    expect(text(html)).toBe("General About it Banner Content");
  });

  test("hides the banner slot when the banner renders nothing or only an empty wrapper", () => {
    for (const banner of [<NoBanner key="null" />, <div key="wrapper" className="w-full" />]) {
      const html = render(
        <SettingsPage title="General" banner={banner}>
          <p>Content</p>
        </SettingsPage>,
      );
      // The slot hides itself when nothing inside it has content
      expect(html).toMatch(/<div class="mt-6 \[&amp;:not\(:has\(:not\(:empty\)\)\)\]:hidden">/);
      expect(text(html)).toBe("General Content");
    }
  });
});

describe("SettingsTheme", () => {
  test("renders nothing until the themes load", () => {
    expect(render(<SettingsTheme view={stubView({ themes: null })} callbacks={callbacks} />)).toBe(
      "",
    );
  });

  test("selects the resolved themes and splits them by appearance", () => {
    const html = render(<SettingsTheme view={stubView()} callbacks={callbacks} />);
    expect(text(html)).toContain("Make Yaak Proxy your own by selecting a theme");
    // The setting names a missing light theme; the select shows the one in use
    expect(html).toMatch(/<option value="hotdog" selected="">Hotdog Stand<\/option>/);
    expect(html).toMatch(/<option value="yaak-dark" selected="">Yaak<\/option>/);
    expect(text(html)).toContain("Hotdog Stand (preview)");
  });

  test("shows only the light theme row in light mode", () => {
    const view = stubView();
    const html = render(
      <SettingsTheme
        view={{ ...view, values: { ...view.values, appearance: "light" } }}
        callbacks={callbacks}
      />,
    );
    expect(text(html)).toContain("Light theme");
    expect(text(html)).not.toContain("Dark theme");
  });
});

describe("SettingsInterface", () => {
  test("reads fonts, sizes and editor options, with the app's sections around them", () => {
    const html = render(
      <SettingsInterface
        view={stubView()}
        callbacks={callbacks}
        leadingSections={<p>Leading</p>}
        trailingSections={<p>Trailing</p>}
      />,
    );
    const t = text(html);
    expect(t).toContain("Font used for Yaak Proxy interface controls.");
    expect(html).toMatch(/<option value="15" selected="">15<\/option>/);
    expect(html).toMatch(/<option value="Menlo" selected="">Menlo<\/option>/);
    expect(html).toMatch(/<option value="vim" selected="">Vim<\/option>/);
    expect(t.indexOf("Leading")).toBeLessThan(t.indexOf("Fonts"));
    expect(t.indexOf("Trailing")).toBeGreaterThan(t.indexOf("Native title bar"));
    expect(t).not.toContain("Hide window controls");
  });

  test("offers hiding window controls where the app draws them", () => {
    const t = text(
      render(
        <SettingsInterface
          view={stubView({ windowControlsSetting: true })}
          callbacks={callbacks}
        />,
      ),
    );
    expect(t).toContain("Hide window controls");
  });
});

describe("SettingsLicense", () => {
  function renderStatus(status: SettingsLicenseStatus | null, extra = {}) {
    const view = stubView();
    return text(
      render(
        <SettingsLicense
          view={{
            ...view,
            license: {
              ...(view.license as NonNullable<SettingsView["license"]>),
              status,
              ...extra,
            },
          }}
          callbacks={callbacks}
        />,
      ),
    );
  }

  test("says each state in the app's name", () => {
    const trialEnd = new Date(Date.now() + 5.5 * 864e5).toISOString();
    expect(renderStatus({ status: "trialing", trialEnd })).toContain(
      "5 days left to evaluate Yaak Proxy for commercial use.",
    );
    expect(renderStatus({ status: "personal_use" })).toContain(
      "You may continue using Yaak Proxy for personal use only.",
    );
    expect(renderStatus({ status: "active" })).toContain("Your license is active");
    expect(renderStatus({ status: "inactive" })).toContain("Your license is invalid.");
    expect(
      renderStatus({
        status: "expired",
        periodEnd: "2026-03-04T00:00:00",
        changesUrl: "https://yaak.app/changes",
      }),
    ).toContain("Your license expired March 04, 2026 .");
    expect(renderStatus({ status: "past_due", billingUrl: "https://yaak.app/b" })).toContain(
      "update your billing info",
    );
    expect(renderStatus({ status: "error", message: "Boom", code: "E1" })).toContain(
      "License check failed: Boom (Code: E1)",
    );
  });

  test("offers deactivation when active and purchase otherwise", () => {
    expect(renderStatus({ status: "active" })).toContain("Deactivate License");
    expect(renderStatus({ status: "personal_use" })).toContain("Purchase License");
    expect(renderStatus(null)).toContain("Activate License");
  });

  test("shows errors, and nothing while the first check runs or without a license", () => {
    expect(renderStatus(null, { checkError: "Offline", activateError: "Bad key" })).toMatch(
      /Offline.*Bad key/,
    );
    expect(renderStatus(null, { pending: true })).toBe("");
    expect(
      render(<SettingsLicense view={stubView({ license: null })} callbacks={callbacks} />),
    ).toBe("");
  });
});

describe("SettingsDialog", () => {
  test("lists shared and app tabs in order and shows the default one", () => {
    const view = stubView();
    const html = render(
      <SettingsDialog
        titlebar={null}
        defaultTab="proxy"
        tabs={[
          {
            value: "general",
            label: "General",
            icon: "settings",
            content: <SettingsGeneral view={view} callbacks={callbacks} />,
          },
          { value: "proxy", label: "Proxy", icon: "wifi", content: <p>Proxy tab content</p> },
          { value: "hidden", label: "Hidden", icon: "info", hidden: true, content: null },
        ]}
      />,
    );
    const t = text(html);
    expect(t.indexOf("General")).toBeLessThan(t.indexOf("Proxy"));
    expect(t).toContain("Proxy tab content");
    expect(t).not.toContain("Hidden");
  });
});

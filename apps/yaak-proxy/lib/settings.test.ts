import { describe, expect, test } from "vite-plus/test";
import {
  CAPTURE_LIMIT_OPTIONS,
  DEFAULT_SETTINGS_VALUES,
  KEEP_TRAFFIC_OPTIONS,
  proxySettingsView,
  readSettingsValues,
  sizeFromOptionValue,
  sizeOptionsFor,
  sizeOptionValue,
} from "./settings";

const APP = {
  name: "Yaak Proxy",
  version: "2026.11.0",
  dataDir: "/data",
  logDir: "/logs",
  revealPathLabel: "Reveal in Finder",
};

describe("readSettingsValues", () => {
  test("Yaak's defaults when nothing is stored", () => {
    expect(readSettingsValues(null)).toEqual(DEFAULT_SETTINGS_VALUES);
    expect(readSettingsValues("not json")).toEqual(DEFAULT_SETTINGS_VALUES);
    expect(DEFAULT_SETTINGS_VALUES.interfaceFontSize).toBe(15);
    expect(DEFAULT_SETTINGS_VALUES.editorFontSize).toBe(13);
  });

  test("stored values over the defaults, the wrong types ignored", () => {
    const values = readSettingsValues(
      JSON.stringify({ appearance: "dark", interfaceFontSize: "big", editorFont: "Menlo", x: 1 }),
    );
    expect(values.appearance).toBe("dark");
    expect(values.interfaceFontSize).toBe(15);
    expect(values.editorFont).toBe("Menlo");
    expect("x" in values).toBe(false);
  });
});

describe("proxySettingsView", () => {
  test("resolves the system appearance and the themes", () => {
    const view = proxySettingsView(DEFAULT_SETTINGS_VALUES, APP, "dark");
    expect(view.themes?.resolvedAppearance).toBe("dark");
    expect(view.themes?.active.dark).toBe(true);
    const light = proxySettingsView(
      { ...DEFAULT_SETTINGS_VALUES, appearance: "light" },
      APP,
      "dark",
    );
    expect(light.themes?.resolvedAppearance).toBe("light");
    expect(light.themes?.active.dark).toBe(false);
  });

  test("a missing theme falls back to Yaak's", () => {
    const view = proxySettingsView({ ...DEFAULT_SETTINGS_VALUES, themeDark: "gone" }, APP, "dark");
    expect(view.themes?.dark.id).toBe(DEFAULT_SETTINGS_VALUES.themeDark);
  });

  test("leaves out what the proxy doesn't have yet", () => {
    const view = proxySettingsView(DEFAULT_SETTINGS_VALUES, APP, "light");
    expect(view.updates).toBeNull();
    expect(view.license).toBeNull();
    expect(view.hiddenInterfaceRows).toEqual([
      "editorKeymap",
      "editorSoftWrap",
      "coloredMethods",
      "nativeTitlebar",
    ]);
    expect(view.app.name).toBe("Yaak Proxy");
  });
});

describe("size options", () => {
  test("keep traffic is unlimited by default", () => {
    expect(KEEP_TRAFFIC_OPTIONS[0]).toMatchObject({ label: "Unlimited", bytes: null });
    expect(sizeOptionValue(null)).toBe("none");
    expect(sizeFromOptionValue("none")).toBeNull();
  });

  test("labels in the units the limits are set in", () => {
    expect(CAPTURE_LIMIT_OPTIONS.map((o) => o.label)).toEqual([
      "1 MB",
      "5 MB",
      "10 MB",
      "50 MB",
      "100 MB",
    ]);
    expect(KEEP_TRAFFIC_OPTIONS.map((o) => o.label)).toEqual([
      "Unlimited",
      "500 MB",
      "1 GB",
      "2 GB",
      "5 GB",
      "10 GB",
      "20 GB",
    ]);
  });

  test("values round trip", () => {
    for (const o of [...KEEP_TRAFFIC_OPTIONS, ...CAPTURE_LIMIT_OPTIONS]) {
      expect(sizeFromOptionValue(sizeOptionValue(o.bytes))).toBe(o.bytes);
    }
    expect(sizeFromOptionValue("abc")).toBeNull();
  });

  test("a size set elsewhere gets its own option, in order", () => {
    const options = sizeOptionsFor(CAPTURE_LIMIT_OPTIONS, 3 * 1024 * 1024);
    expect(options.map((o) => o.bytes)).toEqual([
      1024 * 1024,
      3 * 1024 * 1024,
      5 * 1024 * 1024,
      10 * 1024 * 1024,
      50 * 1024 * 1024,
      100 * 1024 * 1024,
    ]);
    expect(sizeOptionsFor(CAPTURE_LIMIT_OPTIONS, 10 * 1024 * 1024)).toBe(CAPTURE_LIMIT_OPTIONS);
  });
});

import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import type { Settings } from "@yaakapp-internal/models";
import { describe, expect, test } from "vite-plus/test";
import {
  licenseStatusFromCheck,
  settingsValuesFromModel,
  themesViewFromResolved,
} from "./settingsView";

describe("settingsValuesFromModel", () => {
  test("picks the shared tabs' values and nothing client-only", () => {
    const settings = {
      model: "settings",
      id: "st_1",
      appearance: "dark",
      themeLight: "yaak-light",
      themeDark: "hotdog",
      interfaceFont: "Inter",
      interfaceFontSize: 15,
      editorFont: null,
      editorFontSize: 13,
      editorKeymap: "emacs",
      editorSoftWrap: false,
      coloredMethods: true,
      useNativeTitlebar: true,
      hideWindowControls: true,
      updateChannel: "beta",
      autoupdate: false,
      autoDownloadUpdates: false,
      checkNotifications: false,
      promptFeedback: false,
      openWorkspaceNewWindow: true,
      hideLicenseBadge: true,
      clientCertificates: [],
    } as unknown as Settings;

    expect(settingsValuesFromModel(settings)).toEqual({
      appearance: "dark",
      themeLight: "yaak-light",
      themeDark: "hotdog",
      interfaceFont: "Inter",
      interfaceFontSize: 15,
      editorFont: null,
      editorFontSize: 13,
      editorKeymap: "emacs",
      editorSoftWrap: false,
      coloredMethods: true,
      useNativeTitlebar: true,
      hideWindowControls: true,
      updateChannel: "beta",
      autoupdate: false,
      autoDownloadUpdates: false,
      checkNotifications: false,
      promptFeedback: false,
    });
  });
});

describe("licenseStatusFromCheck", () => {
  test("is null without a check", () => {
    expect(licenseStatusFromCheck(null)).toBeNull();
    expect(licenseStatusFromCheck(undefined)).toBeNull();
  });

  test("keeps what each state's copy needs", () => {
    const cases: [LicenseCheckStatus, unknown][] = [
      [
        { status: "active", data: { periodEnd: "2027-01-01", cancelAt: null } },
        { status: "active" },
      ],
      [
        { status: "trialing", data: { end: "2026-11-20" } },
        { status: "trialing", trialEnd: "2026-11-20" },
      ],
      [{ status: "personal_use", data: { trial_ended: "2026-01-01" } }, { status: "personal_use" }],
      [{ status: "inactive", data: { status: "canceled" } }, { status: "inactive" }],
      [
        {
          status: "expired",
          data: {
            changes: 3,
            changesUrl: "https://yaak.app/changes",
            billingUrl: "https://yaak.app/billing",
            periodEnd: "2026-03-04",
          },
        },
        { status: "expired", periodEnd: "2026-03-04", changesUrl: "https://yaak.app/changes" },
      ],
      [
        { status: "past_due", data: { billingUrl: "https://yaak.app/billing", periodEnd: "x" } },
        { status: "past_due", billingUrl: "https://yaak.app/billing" },
      ],
      [
        { status: "error", data: { message: "Boom", code: "E1" } },
        { status: "error", message: "Boom", code: "E1" },
      ],
    ];
    for (const [check, expected] of cases) {
      expect(licenseStatusFromCheck(check)).toEqual(expected);
    }
  });
});

describe("themesViewFromResolved", () => {
  const light = { id: "yaak-light", label: "Yaak", dark: false, base: {} };
  const dark = { id: "yaak-dark", label: "Yaak", dark: true, base: {} };

  test("is null while the themes load", () => {
    expect(themesViewFromResolved(undefined, "dark")).toBeNull();
  });

  test("keeps each theme's id, label and darkness, and the resolved appearance", () => {
    expect(
      themesViewFromResolved({ themes: [dark, light], light, dark, active: dark }, "dark"),
    ).toEqual({
      themes: [
        { id: "yaak-dark", label: "Yaak", dark: true },
        { id: "yaak-light", label: "Yaak", dark: false },
      ],
      light: { id: "yaak-light", label: "Yaak", dark: false },
      dark: { id: "yaak-dark", label: "Yaak", dark: true },
      active: { id: "yaak-dark", label: "Yaak", dark: true },
      resolvedAppearance: "dark",
    });
  });
});

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import { useEffect, useState } from "react";
import { appInfo } from "../lib/appInfo";
import { DismissibleBanner } from "./core/DismissibleBanner";

export function CommercialUseBanner({
  children,
  source,
  title,
}: {
  children: string;
  source: string;
  title: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let canceled = false;

    shouldShowCommercialUsePrompt()
      .then((shouldShow) => {
        if (!canceled) setVisible(shouldShow);
      })
      .catch(console.error);

    return () => {
      canceled = true;
    };
  }, [source]);

  if (!visible) return null;

  return (
    <div className="w-full">
      <DismissibleBanner
        id="commercial-use"
        color="primary"
        className="w-full"
        dismissForDays={7}
        actions={[
          {
            label: "View plans",
            color: "primary",
            variant: "solid",
            onClick: () => {
              openCommercialUsePricing(source).catch(console.error);
            },
          },
        ]}
      >
        <div className="text-sm">
          <p className="font-semibold text-text">{title}</p>
          <p className="mt-0.5 text-text-subtle">{children}</p>
        </div>
      </DismissibleBanner>
    </div>
  );
}

async function shouldShowCommercialUsePrompt(): Promise<boolean> {
  // Open-source builds omit the Rust license plugin, so never show commercial-use prompts there.
  if (appInfo.featureLicense !== true) {
    return false;
  }

  try {
    const license = await invoke<LicenseCheckStatus>("plugin:yaak-license|check");
    return license.status !== "active" && license.status !== "trialing";
  } catch (err) {
    console.log("Failed to check license before commercial-use prompt", err);
    return true;
  }
}

async function openCommercialUsePricing(source: string): Promise<void> {
  await openUrl(`https://yaak.app/pricing?s=${source}&ref=app.yaak.desktop`).catch(console.error);
}

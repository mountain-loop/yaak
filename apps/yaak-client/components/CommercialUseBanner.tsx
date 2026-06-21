import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import { useEffect, useState } from "react";
import { useKeyValue } from "../hooks/useKeyValue";
import { appInfo } from "../lib/appInfo";
import { pricingUrl } from "../lib/pricingUrl";
import { DismissibleBanner } from "./core/DismissibleBanner";

const COMMERCIAL_USE_SNOOZE_DAYS = 7;

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
  const {
    isLoading: isSnoozeLoading,
    set: setSnoozedAt,
    value: snoozedAt,
  } = useKeyValue<string | null>({
    namespace: "global",
    key: "commercial-use-banner-snoozed-at",
    fallback: null,
  });

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

  if (
    !visible ||
    isSnoozeLoading ||
    isWithinDays(snoozedAt, COMMERCIAL_USE_SNOOZE_DAYS)
  ) {
    return null;
  }

  return (
    <div className="w-full">
      <DismissibleBanner
        id={`commercial-use:${source}`}
        color="info"
        className="w-full"
        onDismiss={() => setSnoozedAt(new Date().toISOString())}
        actions={[
          {
            label: "View plans",
            color: "info",
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
  await openUrl(pricingUrl(`app.commercial-use.${source}`)).catch(console.error);
}

function isWithinDays(date: string | null, days: number): boolean {
  if (date == null) return false;

  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return false;

  return Date.now() - time < days * 24 * 60 * 60 * 1000;
}

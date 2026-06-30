import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyValue } from "../hooks/useKeyValue";
import { appInfo } from "../lib/appInfo";
import { pricingUrl } from "../lib/pricingUrl";
import { DismissibleBanner } from "./core/DismissibleBanner";

const COMMERCIAL_USE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const COMMERCIAL_USE_BANNER_MESSAGE =
  "Personal use of Yaak is free. If you’re using Yaak at work, please purchase a license.";

export function CommercialUseBanner({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const [visible, setVisible] = useState(false);
  const snoozeStartedRef = useRef(false);
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

  const snooze = getSnooze(snoozedAt, COMMERCIAL_USE_SNOOZE_MS);
  const handleShow = useCallback(() => {
    if (snoozeStartedRef.current || snooze.active) {
      return;
    }

    snoozeStartedRef.current = true;
    setSnoozedAt(JSON.stringify({ source, at: new Date().toISOString() })).catch(console.error);
  }, [setSnoozedAt, snooze.active, source]);

  if (!visible || isSnoozeLoading || (snooze.active && snooze.source !== source)) {
    return null;
  }

  return (
    <div className="w-full">
      <DismissibleBanner
        id={`commercial-use:${source}`}
        color="info"
        className="w-full"
        onDismiss={() => setSnoozedAt(new Date().toISOString())}
        onShow={handleShow}
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
          <p className="mt-0.5 text-text-subtle">{COMMERCIAL_USE_BANNER_MESSAGE}</p>
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

function getSnooze(value: string | null, ms: number): { active: boolean; source: string | null } {
  if (value == null) return { active: false, source: null };

  try {
    const snooze = JSON.parse(value) as { source?: unknown; at?: unknown };
    const source = typeof snooze.source === "string" ? snooze.source : null;
    const at = typeof snooze.at === "string" ? snooze.at : null;
    return { active: isWithinMs(at, ms), source };
  } catch {
    // Older builds stored only the timestamp, so keep respecting that as a global snooze.
    return { active: isWithinMs(value, ms), source: null };
  }
}

function isWithinMs(date: string | null, ms: number): boolean {
  if (date == null) return false;

  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return false;

  return Date.now() - time < ms;
}

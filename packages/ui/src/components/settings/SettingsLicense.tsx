import { pluralizeCount } from "@yaakapp-internal/lib/pluralize";
import { differenceInDays } from "date-fns";
import { formatDate } from "date-fns/format";
import { useState } from "react";
import { useToggle } from "../../hooks/useToggle";
import { Banner } from "../Banner";
import { Button } from "../Button";
import { ExternalLink } from "../ExternalLink";
import { Icon } from "../Icon";
import { PlainInput } from "../PlainInput";
import { Separator } from "../Separator";
import { HStack, VStack } from "../Stacks";
import type { SettingsCallbacks, SettingsLicenseStatus, SettingsView } from "./types";

export interface SettingsLicenseProps {
  view: Pick<SettingsView, "app" | "license">;
  callbacks: Pick<
    SettingsCallbacks,
    "onActivateLicense" | "onDeactivateLicense" | "onOpenUrl" | "pricingUrl"
  >;
}

export function SettingsLicense({ view, callbacks }: SettingsLicenseProps) {
  const [key, setKey] = useState<string>("");
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);
  const license = view.license;

  if (license == null || license.pending) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {license.status && (
        <LicenseStatusBanner
          status={license.status}
          appName={view.app.name}
          callbacks={callbacks}
        />
      )}

      {license.checkError && <Banner color="danger">{license.checkError}</Banner>}
      {license.activateError && <Banner color="danger">{license.activateError}</Banner>}

      {license.status?.status === "active" ? (
        <HStack space={2}>
          <Button
            variant="border"
            color="secondary"
            size="sm"
            onClick={() => callbacks.onDeactivateLicense()}
          >
            Deactivate License
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() =>
              callbacks.onOpenUrl("https://yaak.app/dashboard?intent=app.license.support")
            }
            rightSlot={<Icon icon="external_link" />}
          >
            Direct Support
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={toggleActivateFormVisible}>
            Activate License
          </Button>
          <Button
            size="sm"
            color="primary"
            rightSlot={<Icon icon="external_link" />}
            onClick={() =>
              callbacks.onOpenUrl(
                callbacks.pricingUrl(`app.license.purchase.${license.status?.status ?? "unknown"}`),
              )
            }
          >
            Purchase License
          </Button>
        </HStack>
      )}

      {activateFormVisible && (
        <VStack
          as="form"
          space={3}
          className="max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await callbacks.onActivateLicense(key);
            toggleActivateFormVisible();
          }}
        >
          <PlainInput
            autoFocus
            label="License Key"
            name="key"
            onChange={setKey}
            placeholder="YK1-XXXXX-XXXXX-XXXXX-XXXXX"
          />
          <Button type="submit" color="primary" size="sm" isLoading={license.activating}>
            Submit
          </Button>
        </VStack>
      )}
    </div>
  );
}

function LicenseStatusBanner({
  status,
  appName,
  callbacks,
}: {
  status: SettingsLicenseStatus;
  appName: string;
  callbacks: SettingsLicenseProps["callbacks"];
}) {
  const link = (href: string, children: string, noUnderline?: boolean) => (
    <ExternalLink href={href} noUnderline={noUnderline} onOpen={callbacks.onOpenUrl}>
      {children}
    </ExternalLink>
  );

  switch (status.status) {
    case "active":
      return <Banner color="success">Your license is active 🥳</Banner>;

    case "trialing":
      return (
        <Banner color="info" className="max-w-lg">
          <p className="w-full">
            <strong>{pluralizeCount("day", differenceInDays(status.trialEnd, new Date()))}</strong>{" "}
            {`left to evaluate ${appName} for commercial use.`}
            <br />
            <span className="opacity-50">Personal use is always free, forever.</span>
            <Separator className="my-2" />
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
              {link(callbacks.pricingUrl(`app.license.learn.${status.status}`), "Learn More", true)}
            </div>
          </p>
        </Banner>
      );

    case "personal_use":
      return (
        <Banner color="notice" className="max-w-lg">
          <p className="w-full">
            Your commercial-use trial has ended.
            <br />
            <span className="opacity-50">
              {`You may continue using ${appName} for personal use only.`}
              <br />A license is required for commercial use.
            </span>
            <Separator className="my-2" />
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
              {link(callbacks.pricingUrl(`app.license.learn.${status.status}`), "Learn More", true)}
            </div>
          </p>
        </Banner>
      );

    case "inactive":
      return (
        <Banner color="danger">
          Your license is invalid. Please {link("https://yaak.app/dashboard", "Sign In")} for more
          details
        </Banner>
      );

    case "expired":
      return (
        <Banner color="notice">
          Your license expired <strong>{formatDate(status.periodEnd, "MMMM dd, yyyy")}</strong>.
          Please {link("https://yaak.app/dashboard", "Resubscribe")} to continue receiving updates.
          {status.changesUrl && (
            <>
              <br />
              {link(status.changesUrl, "What's new in latest builds")}
            </>
          )}
        </Banner>
      );

    case "past_due":
      return (
        <Banner color="danger">
          <strong>Your payment method needs attention.</strong>
          <br />
          To re-activate your license, please {link(status.billingUrl, "update your billing info")}.
        </Banner>
      );

    case "error":
      return (
        <Banner color="danger">
          License check failed: {status.message} (Code: {status.code})
        </Banner>
      );
  }
}

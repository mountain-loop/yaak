import {
  Button,
  CONTROL_TOOLTIP_DELAY,
  Dropdown,
  type DropdownItem,
  Icon,
  IconButton,
  Tooltip,
} from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { useLocalStorage } from "react-use";
import { canTrustHere, useDecrypt, useTrustCertificate, useTrusting } from "../hooks/useDecrypt";
import { useDecryptList } from "../hooks/useDecryptList";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { everythingEdit, listEdit, setDecrypted } from "../lib/decrypt";
import { chooseOptions, connectionCount, stripState } from "../lib/httpsStrip";
import { sidebarFlowsAtom } from "../lib/store";
import { AppIcon } from "./AppIcon";
import { SETTINGS_TAB_PROXY, useOpenSettings } from "./Settings";

const STRIP =
  "flex items-center gap-2.5 h-[2.2rem] mx-2 mb-1 pl-3 pr-1.5 rounded-md bg-surface-highlight/45 border border-border-subtle text-sm text-text-subtle min-w-0";

/**
 * Above the list while nothing is decrypted: says once that HTTPS is encrypted, and offers
 * Decrypt Everything, or Choose… for apps and sites one at a time. Goes once anything is on
 * the list, or when dismissed; comes back, with Trust, while the list decrypts something the
 * certificate isn't trusted for.
 */
export function HttpsStrip() {
  const list = useDecryptList();
  const flows = useAtomValue(sidebarFlowsAtom);
  const caStatus = useRpcQuery("ca_status", {});
  const [dismissed, setDismissed] = useLocalStorage("https_strip_dismissed", false);
  // Kept while Choose… is open, so checking a row there leaves the menu where it is.
  const [choosing, setChoosing] = useState(false);
  const { apply } = useDecrypt();
  const trusting = useTrusting();
  const trust = useTrustCertificate();
  const openSettings = useOpenSettings();
  const encrypted = useMemo(() => flows.filter((f) => f.tunnelled).length, [flows]);
  const state = stripState({
    list,
    encrypted,
    dismissed: dismissed ?? false,
    trusted: caStatus.data?.trusted ?? null,
    canTrust: canTrustHere(),
  });
  const options = useMemo(() => chooseOptions(flows, list), [flows, list]);

  if (state === "hidden" && !choosing) return null;

  if (state === "broken") {
    return (
      <div className={STRIP}>
        <Icon icon="shield_off" size="sm" color="warning" className="shrink-0" />
        <span className="text-text shrink-0">Certificate not trusted</span>
        <span className="truncate">Required to decrypt</span>
        <Button
          size="2xs"
          color="primary"
          className="ml-auto shrink-0"
          isLoading={trusting}
          onClick={() => trust.mutate({})}
        >
          {trusting ? "Waiting for macOS" : "Trust"}
        </Button>
      </div>
    );
  }

  const items: DropdownItem[] = [
    { type: "separator", label: "Apps", hidden: options.apps.length === 0 },
    ...options.apps.map((app): DropdownItem => ({
      label:
        app.path == null ? (
          app.name
        ) : (
          <span className="flex items-center gap-2">
            <AppIcon path={app.path} className="size-4" />
            {app.name}
          </span>
        ),
      keepOpenOnSelect: true,
      leftSlot: <Check on={app.checked} />,
      rightSlot: <Count n={app.count} />,
      onSelect: async () => {
        const subject = { kind: "app", name: app.name, bundleId: app.bundleId } as const;
        await apply({
          edit: listEdit(list, setDecrypted(list, [subject], !app.checked)),
          message: `${app.checked ? "Stopped decrypting" : "Decrypting"} ${app.name}`,
        });
      },
    })),
    { type: "separator", label: "Sites", hidden: options.sites.length === 0 },
    ...options.sites.map((site): DropdownItem => ({
      label: <span className="font-mono text-xs">*.{site.site}</span>,
      keepOpenOnSelect: true,
      leftSlot: <Check on={site.checked} />,
      rightSlot: <Count n={site.count} />,
      onSelect: async () => {
        const subject = { kind: "site", site: site.site } as const;
        await apply({
          edit: listEdit(list, setDecrypted(list, [subject], !site.checked)),
          message: `${site.checked ? "Stopped decrypting" : "Decrypting"} *.${site.site}`,
        });
      },
    })),
    { type: "separator" },
    {
      label: "Edit List in Settings…",
      leftSlot: <Icon icon="settings" />,
      onSelect: () => openSettings(SETTINGS_TAB_PROXY),
    },
  ];
  return (
    <div className={STRIP}>
      <Icon icon="lock" size="sm" className="shrink-0 text-text-subtle" />
      <span className="text-text shrink-0">HTTPS is encrypted</span>
      <span className="font-mono text-xs text-text-subtlest truncate">
        {connectionCount(encrypted)}
      </span>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <Tooltip
          wrap
          content="New connections, except Apple services and apps that pin"
          delay={CONTROL_TOOLTIP_DELAY}
        >
          <Button
            size="2xs"
            variant={trusting ? "border" : "solid"}
            color={trusting ? "default" : "primary"}
            isLoading={trusting}
            onClick={() =>
              void apply({
                edit: everythingEdit(true),
                message: "Decrypting everything",
                sub: "Except Apple services and apps that pin",
              })
            }
          >
            {trusting ? "Waiting for macOS" : "Decrypt Everything"}
          </Button>
        </Tooltip>
        <Dropdown items={items} onOpen={() => setChoosing(true)} onClose={() => setChoosing(false)}>
          <Button size="2xs" variant="border">
            Choose…
          </Button>
        </Dropdown>
        <IconButton
          size="xs"
          icon="x"
          iconColor="secondary"
          title="Not now"
          tooltip
          onClick={() => setDismissed(true)}
        />
      </div>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return on ? (
    <Icon icon="check" size="sm" />
  ) : (
    <span aria-hidden className="inline-block w-4 h-4" />
  );
}

function Count({ n }: { n: number }) {
  return <span className="pl-4 font-mono text-xs text-text-subtlest">{n.toLocaleString()}</span>;
}

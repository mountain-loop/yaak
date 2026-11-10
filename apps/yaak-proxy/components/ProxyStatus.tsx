import { useQueryClient } from "@tanstack/react-query";
import type { CaStatus, SystemProxyStatus } from "@yaakapp-internal/proxy-lib";
import {
  Button,
  Checkbox,
  Dropdown,
  type DropdownItem,
  type DropdownRef,
  Icon,
  LoadingIcon,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue } from "jotai";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { useRpcEvent } from "../hooks/useRpcEvent";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { helperRegisteredAtAtom } from "../lib/atoms";
import { encryptingPercent } from "../lib/encrypting";
import { environmentExports } from "../lib/env";
import { proxyStatusOf } from "../lib/proxyStatus";
import { proxyStateAtom, systemProxyEverOnAtom } from "../lib/store";
import { helperPollInterval, recordingLabel, systemProxySwitch } from "../lib/systemProxy";
import { onWindowFocus } from "../lib/tauri";
import { useShowToast } from "../lib/toast";

/**
 * The header's state pill and its menu: the listening address, which copies itself, the state,
 * Pause or Resume Recording, Override system proxy, and the certificate. The engine runs for as
 * long as the app does, so the pill shows whether flows are being stored. A certificate that is not trusted steps out of the
 * menu beside the pill until it is. Everything set once and left alone lives in Settings.
 */
export function ProxyStatus() {
  const dropdownRef = useRef<DropdownRef>(null);
  const [copied, setCopied] = useCopied();
  const proxyState = useAtomValue(proxyStateAtom);
  const setup = useProxySetup();
  const execute = useRpcMutation("execute_action");
  const retry = useRpcMutation("take_over");
  const { caStatus, trust, systemProxy, setSystemProxy } = setup;
  const systemSwitch = useSystemProxySwitch(setup);

  const running = proxyState?.state === "running";
  const recording = proxyState?.recording !== false;
  const other = proxyState?.otherOwner ?? null;
  const port = proxyState?.port ?? other?.proxyPort ?? null;
  const untrusted = caStatus.data != null && !caStatus.data.trusted;
  // The same status the header's tint takes its colour from
  const status = proxyStatusOf(proxyState);
  const encrypting = status === "encrypting" ? encryptingPercent(proxyState) : null;

  const stateRow =
    status === "encrypting" ? (
      <MenuRow
        icon={<LoadingIcon size="sm" className="text-text-subtle" />}
        title={`Encrypting stored traffic, ${encrypting}`}
        description="Traffic captured before this version is being encrypted on disk. Recording starts when it's done."
      />
    ) : status === "cli" && other != null ? (
      <MenuRow
        icon={<StateDot state="cli" />}
        title="Running from the CLI"
        description={`Started by yaak proxy start, pid ${other.pid}, since ${timeOf(other.startedAt)}.${other.proxyPort == null ? "" : ` Port ${other.proxyPort}.`}`}
      />
    ) : status === "recording" || status === "paused" ? (
      <MenuRow
        icon={<StateDot state={status} />}
        title={recording ? `Recording on port ${port}` : `Paused on port ${port}`}
        description={
          recording
            ? "Every flow is stored as it passes."
            : "Traffic passes through untouched, and nothing is stored."
        }
      />
    ) : (
      <MenuRow
        icon={<Icon icon="alert_triangle" size="sm" color="warning" />}
        title="Not running"
        description={
          <span className="text-danger">
            {retry.error?.message ?? proxyState?.startError ?? "The proxy has not started."}
          </span>
        }
        action={
          <Button
            size="2xs"
            variant="border"
            isLoading={retry.isPending}
            onClick={(e) => {
              e.stopPropagation();
              retry.mutate({});
            }}
          >
            Retry
          </Button>
        }
      />
    );

  // Until the helper is approved, every change asks for the password; said where it is felt.
  const helperNotice =
    systemProxy.data != null &&
    systemProxy.data.backend !== "helper" &&
    systemProxy.data.helper !== "enabled" &&
    systemProxy.data.helper !== "unavailable";

  const address = port == null ? null : `127.0.0.1:${port}`;
  const items: DropdownItem[] = [
    {
      label: <span className="font-mono">{address}</span>,
      hidden: address == null,
      keepOpenOnSelect: true,
      rightSlot: copied ? (
        <span className="text-xs text-text-subtle">Copied</span>
      ) : (
        <Icon icon="copy" size="sm" className="text-text-subtlest" />
      ),
      onSelect: () => {
        if (address == null) return;
        navigator.clipboard.writeText(address).then(setCopied, console.error);
      },
    },
    { type: "separator", hidden: address == null },
    { type: "content", label: stateRow },
    {
      label: recordingLabel(recording),
      icon: recording ? "circle_pause" : "circle_play",
      hidden: !running,
      hotKeyAction: "recording_toggle",
      hotKeyLabelOnly: true,
      onSelect: () => execute.mutate({ scope: "global", action: "recording_toggle" }),
    },
    { type: "separator" },
    {
      type: "content",
      hidden: systemProxy.data?.supported !== true,
      label: (
        <MenuRow
          icon={<Icon icon="wifi" size="sm" color="secondary" />}
          title="Override system proxy"
          description={
            <>
              <span className={classNames(systemSwitch.failed && "text-danger")}>
                {systemSwitch.description}
              </span>
              {helperNotice && (
                <span className="block text-notice">
                  macOS asks for your password each time until the helper is approved in Settings.
                </span>
              )}
            </>
          }
          action={
            <KeepMenuOpen>
              <Checkbox
                title="Override system proxy"
                hideLabel
                checked={systemSwitch.checked}
                // Only the process that owns the engine routes to it.
                disabled={!running || other != null || setSystemProxy.isPending}
                onChange={(enabled) => setSystemProxy.mutate({ enabled })}
              />
            </KeepMenuOpen>
          }
        />
      ),
    },
    {
      type: "content",
      label: caStatus.data?.trusted ? (
        <MenuRow
          icon={<Icon icon="shield_check" color="success" size="sm" />}
          title="Certificate trusted"
          description="Yaak Proxy CA, in your login keychain."
        />
      ) : (
        <MenuRow
          icon={<Icon icon="shield_off" color="warning" size="sm" />}
          title="Certificate not trusted"
          description={
            trust.error != null ? (
              <span className="text-danger">{trust.error.message}</span>
            ) : trust.isPending ? (
              "Waiting for your password in the macOS prompt."
            ) : (
              "So HTTPS reads as plain text. macOS asks for your login password once."
            )
          }
          action={
            <Button
              size="2xs"
              variant="border"
              color="primary"
              isLoading={trust.isPending}
              onClick={(e) => {
                e.stopPropagation();
                trust.mutate({});
              }}
            >
              {trust.error != null ? "Try again" : "Trust certificate"}
            </Button>
          }
        />
      ),
    },
  ];

  return (
    <>
      <Dropdown ref={dropdownRef} items={items}>
        <Pill color={status === "stopped" ? "warning" : undefined}>
          {status === "encrypting" ? (
            <>
              <LoadingIcon size="xs" />
              <span className="text-text">Encrypting</span>
              <span className="font-mono text-text-subtle">{encrypting}</span>
            </>
          ) : status === "cli" && other != null ? (
            <>
              <StateDot state="cli" />
              <span className="text-text">CLI</span>
            </>
          ) : status === "recording" || status === "paused" ? (
            <>
              <StateDot state={status} />
              <span className="text-text">{recording ? "Recording" : "Paused"}</span>
            </>
          ) : (
            <>
              <Icon icon="alert_triangle" size="xs" />
              Not running
            </>
          )}
          <Icon icon="chevron_down" size="xs" className="text-text-subtlest" />
        </Pill>
      </Dropdown>
      {untrusted && (
        <Pill color="warning" onClick={() => dropdownRef.current?.open()}>
          <Icon icon="shield_off" size="xs" />
          Certificate not trusted
        </Pill>
      )}
    </>
  );
}

/**
 * The certificate and the system proxy, read once and shared by the header and the first-run
 * card, with the actions that change them.
 */
export function useProxySetup() {
  const queryClient = useQueryClient();
  const caStatus = useRpcQuery("ca_status", {});
  const registeredAt = useAtomValue(helperRegisteredAtAtom);
  const systemProxy = useRpcQuery(
    "system_proxy_status",
    {},
    {
      // The helper is approved in System Settings, out of the app's sight.
      refetchInterval: (query) =>
        helperPollInterval(query.state.data?.helper, registeredAt, Date.now()),
    },
  );
  // The user comes back from System Settings, maybe having just allowed the helper.
  const { refetch: refetchSystemProxy } = systemProxy;
  useEffect(() => onWindowFocus(() => void refetchSystemProxy()), [refetchSystemProxy]);
  const trust = useRpcMutation("ca_trust", {
    mutationKey: ["ca_trust"],
    onSuccess: (status) => queryClient.setQueryData<CaStatus>(["ca_status", {}], status),
  });
  const setSystemProxy = useRpcMutation("system_proxy_set", {
    mutationKey: ["system_proxy_set"],
    onSuccess: (status) => {
      queryClient.setQueryData<SystemProxyStatus>(["system_proxy_status", {}], status);
    },
  });
  // The engine turns the system proxy on as it starts, and says so once the prompt is
  // answered, and turns it off as it stops.
  useRpcEvent("proxy_state_changed", () => void systemProxy.refetch());
  // Setup counts as done once the system proxy has been on, whatever it is now.
  const [everOn, setEverOn] = useAtom(systemProxyEverOnAtom);
  const on = systemProxy.data?.enabled === true;
  useEffect(() => {
    if (on && !everOn) setEverOn(true);
  }, [on, everOn, setEverOn]);
  return { caStatus, trust, systemProxy, setSystemProxy };
}

/** The system proxy switch's state, from where it points and the change in flight */
export function useSystemProxySwitch(setup: ReturnType<typeof useProxySetup>) {
  const proxyState = useAtomValue(proxyStateAtom);
  const { systemProxy, setSystemProxy } = setup;
  return systemProxySwitch({
    routing: systemProxy.data?.enabled === true,
    port: proxyState?.port ?? proxyState?.configuredPort ?? null,
    pending: setSystemProxy.isPending ? (setSystemProxy.variables?.enabled ?? null) : null,
    error: setSystemProxy.error?.message ?? null,
    helper: systemProxy.data?.backend === "helper",
  });
}

/** The privileged helper: whether it is installed and approved, and which way changes go */
export function useCopyEnvironment() {
  const proxyState = useAtomValue(proxyStateAtom);
  const caStatus = useRpcQuery("ca_status", {});
  const showToast = useShowToast();
  return async () => {
    const port =
      proxyState?.port ?? proxyState?.otherOwner?.proxyPort ?? proxyState?.configuredPort;
    const caPath = caStatus.data?.certPath;
    if (port == null || caPath == null) return;
    try {
      await navigator.clipboard.writeText(environmentExports(port, caPath));
      showToast({
        message: "Copied the environment. Paste it into a terminal to proxy what runs there.",
      });
    } catch (err) {
      showToast({ message: `Failed to copy: ${String(err)}`, color: "danger" });
    }
  };
}

/** Whether something was just copied, for a moment, and the call that says it was */
function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);
  return [copied, () => setCopied(true)];
}

/** Keeps a click on a control inside a menu row from closing the menu, as a row's click does */
function KeepMenuOpen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops the click reaching the row
    <span className={className} onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface PillProps extends HTMLAttributes<HTMLButtonElement> {
  color?: "warning";
  ref?: Ref<HTMLButtonElement>;
}

function Pill({ children, color, ref, ...props }: PillProps) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className={classNames(
        "pointer-events-auto flex items-center gap-1.5 h-[1.45rem] px-2.5 rounded-full border text-xs",
        "whitespace-nowrap outline-hidden focus-visible:ring-1 ring-border-focus",
        color === "warning"
          ? "border-warning/50 text-warning hover:bg-warning/10"
          : "border-border-subtle text-text-subtle hover:bg-surface-highlight",
      )}
    >
      {children}
    </button>
  );
}

export function StateDot({ state }: { state: "recording" | "paused" | "cli" }) {
  return (
    <span
      aria-hidden
      className={classNames(
        "inline-block w-[7px] h-[7px] rounded-full shrink-0",
        state === "recording" && "bg-success ring-3 ring-success/20",
        state === "cli" && "bg-info ring-3 ring-info/20",
        state === "paused" && "border-[1.5px] border-text-subtlest",
      )}
    />
  );
}

function MenuRow({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3 items-start px-1.5 py-1 w-[24rem] max-w-full">
      <span className="h-5 flex items-center justify-center">{icon}</span>
      <div>
        <div className="text-sm text-text">{title}</div>
        <div className="text-xs text-text-subtle mt-0.5">{description}</div>
      </div>
      <span className="self-center">{action}</span>
    </div>
  );
}

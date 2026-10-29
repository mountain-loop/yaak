import { useQueryClient } from "@tanstack/react-query";
import type { CaStatus, SystemProxyStatus } from "@yaakapp-internal/proxy-lib";
import {
  Button,
  Checkbox,
  Dropdown,
  type DropdownItem,
  type DropdownRef,
  Icon,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue, useStore } from "jotai";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useRef } from "react";
import { useRpcEvent } from "../hooks/useRpcEvent";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { environmentExports } from "../lib/env";
import { proxyStateAtom, refreshProxyState } from "../lib/store";
import { recordingLabel, systemProxySwitch } from "../lib/systemProxy";
import { useShowToast } from "../lib/toast";

/**
 * The header's state pill and its menu: recording, the system proxy, the certificate and HTTP/2. The
 * engine runs for as long as the app does, so the pill shows whether flows are being stored. A
 * certificate that is not trusted steps out of the menu beside the pill until it is.
 */
export function ProxyStatus() {
  const dropdownRef = useRef<DropdownRef>(null);
  const proxyState = useAtomValue(proxyStateAtom);
  const setup = useProxySetup();
  const execute = useRpcMutation("execute_action");
  const retry = useRpcMutation("take_over");
  const setAtLaunch = useSetSystemProxyAtLaunch();
  const setHttpVersion = useSetHttpVersion();
  const copyEnvironment = useCopyEnvironment();
  const { caStatus, trust, systemProxy, setSystemProxy } = setup;
  const systemSwitch = useSystemProxySwitch(setup);

  const running = proxyState?.state === "running";
  const recording = proxyState?.recording !== false;
  const other = proxyState?.otherOwner ?? null;
  const port = proxyState?.port ?? other?.proxyPort ?? null;
  const untrusted = caStatus.data != null && !caStatus.data.trusted;

  const stateRow =
    other != null ? (
      <MenuRow
        icon={<StateDot state="cli" />}
        title="Running from the CLI"
        description={`Started by yaak proxy start, pid ${other.pid}, since ${timeOf(other.startedAt)}.${other.proxyPort == null ? "" : ` Port ${other.proxyPort}.`}`}
      />
    ) : running ? (
      <MenuRow
        icon={<StateDot state={recording ? "recording" : "paused"} />}
        title={recording ? `Recording on port ${port}` : `Paused on port ${port}`}
        description={
          recording
            ? "Listening on 127.0.0.1, and storing every flow."
            : "Traffic passes through untouched, and no flows are stored."
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

  const items: DropdownItem[] = [
    { type: "content", label: stateRow },
    { type: "separator", hidden: systemProxy.data?.supported !== true },
    {
      type: "content",
      hidden: systemProxy.data?.supported !== true,
      label: (
        <MenuRow
          icon={<Icon icon="wifi" size="sm" color="secondary" />}
          title="Override system proxy"
          description={
            <span className={classNames(systemSwitch.failed && "text-danger")}>
              {systemSwitch.description}
            </span>
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
      hidden: systemProxy.data?.supported !== true,
      label: (
        <KeepMenuOpen className="block pl-[2.125rem] pr-1.5 pb-1.5">
          <Checkbox
            title={
              <span className="text-xs text-text-subtle">Override system proxy at launch</span>
            }
            checked={proxyState?.systemProxyAtLaunch ?? true}
            disabled={setAtLaunch.isPending}
            onChange={(enabled) => setAtLaunch.mutate({ enabled })}
          />
        </KeepMenuOpen>
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
    {
      type: "content",
      label: (
        <MenuRow
          icon={<Icon icon="zap" size="sm" color="secondary" />}
          title="HTTP/2"
          description="Lets browsers send many requests at once. Turn off for apps that misbehave on it. Applies to new connections."
          action={
            <KeepMenuOpen>
              <Checkbox
                title="HTTP/2"
                hideLabel
                checked={proxyState?.httpVersion !== "http1Only"}
                // The owner's engine would not see the change until it restarts.
                disabled={other != null || setHttpVersion.isPending}
                onChange={(enabled) =>
                  setHttpVersion.mutate({ httpVersion: enabled ? "auto" : "http1Only" })
                }
              />
            </KeepMenuOpen>
          }
        />
      ),
    },
    { type: "separator" },
    {
      label: "Copy Environment for a Terminal",
      icon: "square_terminal",
      onSelect: copyEnvironment,
    },
    {
      label: recordingLabel(recording),
      icon: recording ? "circle_pause" : "circle_play",
      hidden: !running,
      hotKeyAction: "recording_toggle",
      hotKeyLabelOnly: true,
      onSelect: () => execute.mutate({ scope: "global", action: "recording_toggle" }),
    },
  ];

  return (
    <>
      {untrusted && (
        <Pill color="warning" onClick={() => dropdownRef.current?.open()}>
          <Icon icon="shield_off" size="xs" />
          Certificate not trusted
        </Pill>
      )}
      <Dropdown ref={dropdownRef} items={items}>
        <Pill color={!running && other == null && proxyState != null ? "warning" : undefined}>
          {other != null ? (
            <>
              <StateDot state="cli" />
              <span className="text-text">CLI</span>
              {other.proxyPort != null && (
                <span className="font-mono text-text-subtle">:{other.proxyPort}</span>
              )}
            </>
          ) : running ? (
            <>
              <StateDot state={recording ? "recording" : "paused"} />
              <span className="text-text">{recording ? "Recording" : "Paused"}</span>
              {port != null && <span className="font-mono text-text-subtle">:{port}</span>}
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
  const systemProxy = useRpcQuery("system_proxy_status", {});
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
  });
}

/** Saves whether the system proxy turns on as the app launches */
function useSetSystemProxyAtLaunch() {
  const store = useStore();
  return useRpcMutation("set_system_proxy_at_launch", {
    onSettled: () => void refreshProxyState(store),
  });
}

/** Saves the HTTP versions offered to clients, which the engine applies to new connections */
function useSetHttpVersion() {
  const store = useStore();
  return useRpcMutation("set_http_version", {
    onSettled: () => void refreshProxyState(store),
  });
}

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

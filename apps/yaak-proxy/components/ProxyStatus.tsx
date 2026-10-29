import { useQueryClient } from "@tanstack/react-query";
import type { CaStatus, SystemProxyStatus } from "@yaakapp-internal/proxy-lib";
import { Button, Dropdown, type DropdownItem, type DropdownRef, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useRef } from "react";
import { useRpcEvent } from "../hooks/useRpcEvent";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { environmentExports } from "../lib/env";
import { proxyStateAtom, refreshProxyState } from "../lib/store";
import { showToastAtom } from "../lib/toast";

/** How often the system proxy is read while it is meant to be on and is not yet */
const SYSTEM_PROXY_POLL_MS = 2000;

/**
 * The header's state pill and its menu: the engine, the system proxy and the certificate. The
 * system proxy and the certificate step out of the menu beside the pill while they are broken.
 */
export function ProxyStatus() {
  const dropdownRef = useRef<DropdownRef>(null);
  const proxyState = useAtomValue(proxyStateAtom);
  const setup = useProxySetup();
  const execute = useRpcMutation("execute_action");
  const copyEnvironment = useCopyEnvironment();
  const { caStatus, trust, systemProxy, setSystemProxy } = setup;

  const running = proxyState?.state === "running";
  const other = proxyState?.otherOwner ?? null;
  const port = proxyState?.port ?? other?.proxyPort ?? null;
  const untrusted = caStatus.data != null && !caStatus.data.trusted;
  const systemProxyBroken =
    setSystemProxy.error != null ||
    (running &&
      proxyState?.systemProxyWanted === true &&
      systemProxy.data?.supported === true &&
      !systemProxy.data.enabled &&
      !setSystemProxy.isPending);

  const items: DropdownItem[] = [
    {
      type: "content",
      label:
        other != null ? (
          <MenuRow
            icon={<StateDot state="cli" />}
            title="Running from the CLI"
            description={`Started by yaak proxy start, pid ${other.pid}, since ${timeOf(other.startedAt)}.${other.proxyPort == null ? "" : ` Port ${other.proxyPort}.`}`}
          />
        ) : (
          <MenuRow
            icon={<StateDot state={running ? "running" : "stopped"} />}
            title={running && port != null ? `Running on port ${port}` : "Stopped"}
            description={
              running
                ? "Listening on 127.0.0.1."
                : "Start the proxy to capture traffic from apps pointed at it."
            }
          />
        ),
    },
    { type: "separator", hidden: systemProxy.data?.supported !== true },
    {
      type: "content",
      hidden: systemProxy.data?.supported !== true,
      label: (
        <MenuRow
          icon={<Icon icon="wifi" size="sm" color="secondary" />}
          title="System proxy"
          description={<SystemProxyDescription setup={setup} />}
          action={
            <Switch
              on={
                setSystemProxy.isPending
                  ? (setSystemProxy.variables?.enabled ?? false)
                  : systemProxy.data?.enabled === true
              }
              busy={setSystemProxy.isPending}
              disabled={other != null}
              label="System proxy"
              onChange={(enabled) => setSystemProxy.mutate({ enabled })}
            />
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
    { type: "separator" },
    {
      label: "Copy Environment for a Terminal",
      icon: "square_terminal",
      onSelect: copyEnvironment,
    },
    {
      label: running ? "Stop Proxy" : "Start Proxy",
      icon: running ? "circle_stop" : "circle_play",
      hidden: other != null,
      hotKeyAction: running ? "proxy_stop" : "proxy_start",
      hotKeyLabelOnly: true,
      onSelect: () => {
        execute.mutate({ scope: "global", action: running ? "proxy_stop" : "proxy_start" });
      },
    },
  ];

  return (
    <>
      {systemProxyBroken && (
        <Pill color="warning" onClick={() => dropdownRef.current?.open()}>
          <Icon icon="wifi" size="xs" />
          {setSystemProxy.error != null ? "System proxy not changed" : "System proxy off"}
        </Pill>
      )}
      {untrusted && (
        <Pill color="warning" onClick={() => dropdownRef.current?.open()}>
          <Icon icon="shield_off" size="xs" />
          Certificate not trusted
        </Pill>
      )}
      <Dropdown ref={dropdownRef} items={items}>
        <Pill>
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
              <StateDot state="running" />
              <span className="text-text">Running</span>
              {port != null && <span className="font-mono text-text-subtle">:{port}</span>}
            </>
          ) : (
            <>
              <StateDot state="stopped" />
              Stopped
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
  const store = useStore();
  const caStatus = useRpcQuery("ca_status", {});
  const proxyState = useAtomValue(proxyStateAtom);
  // The engine turns the system proxy on in the background as it starts, through a password
  // prompt that can take a while, so its state is read again until it matches the setting.
  const settling = proxyState?.state === "running" && proxyState.systemProxyWanted;
  const systemProxy = useRpcQuery(
    "system_proxy_status",
    {},
    {
      refetchInterval: (query) =>
        settling && query.state.data?.supported === true && !query.state.data.enabled
          ? SYSTEM_PROXY_POLL_MS
          : false,
    },
  );
  const trust = useRpcMutation("ca_trust", {
    mutationKey: ["ca_trust"],
    onSuccess: (status) => queryClient.setQueryData<CaStatus>(["ca_status", {}], status),
  });
  const setSystemProxy = useRpcMutation("system_proxy_set", {
    mutationKey: ["system_proxy_set"],
    onSuccess: (status) => {
      queryClient.setQueryData<SystemProxyStatus>(["system_proxy_status", {}], status);
      void refreshProxyState(store);
    },
  });
  // The system proxy follows the engine on and off.
  useRpcEvent("proxy_state_changed", () => {
    setTimeout(() => void systemProxy.refetch(), 1500);
  });
  return { caStatus, trust, systemProxy, setSystemProxy };
}

/** Copies the shell exports for the engine's port and the CA, with a toast */
export function useCopyEnvironment() {
  const proxyState = useAtomValue(proxyStateAtom);
  const caStatus = useRpcQuery("ca_status", {});
  const showToast = useSetAtom(showToastAtom);
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

function SystemProxyDescription({ setup }: { setup: ReturnType<typeof useProxySetup> }) {
  const { systemProxy, setSystemProxy } = setup;
  if (setSystemProxy.isPending) return <>Waiting for your password in the macOS prompt.</>;
  if (setSystemProxy.error != null) {
    return <span className="text-danger">{setSystemProxy.error.message}</span>;
  }
  const services = systemProxy.data?.services.map((s) => s.name) ?? [];
  if (systemProxy.data?.enabled && services.length > 0) {
    return <>{`${services.join(" and ")} point at 127.0.0.1:${systemProxy.data.port}.`}</>;
  }
  return <>Routes this Mac's web traffic through Yaak Proxy. Turns off when it quits.</>;
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

export function StateDot({ state }: { state: "running" | "stopped" | "cli" }) {
  return (
    <span
      aria-hidden
      className={classNames(
        "inline-block w-[7px] h-[7px] rounded-full shrink-0",
        state === "running" && "bg-success ring-3 ring-success/20",
        state === "cli" && "bg-info ring-3 ring-info/20",
        state === "stopped" && "border-[1.5px] border-text-subtlest",
      )}
    />
  );
}

/** An on and off switch, which spins while its change waits on the person */
export function Switch({
  on,
  busy,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={classNames(
        "relative inline-flex items-center w-[1.9rem] h-[1.1rem] rounded-full transition-colors shrink-0",
        "outline-hidden focus-visible:ring-1 ring-border-focus disabled:opacity-60",
        on ? "bg-primary" : "bg-border",
      )}
    >
      <span
        className={classNames(
          "absolute w-[0.8rem] h-[0.8rem] rounded-full bg-[#fff] shadow-sm transition-[left]",
          on ? "left-[0.95rem]" : "left-[0.15rem]",
          busy && "animate-pulse",
        )}
      />
    </button>
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

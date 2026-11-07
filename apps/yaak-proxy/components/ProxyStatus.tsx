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
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useEffect, useRef } from "react";
import { useRpcEvent } from "../hooks/useRpcEvent";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { helperDialogOpenAtom, helperRegisteredAtAtom } from "../lib/atoms";
import { encryptingPercent } from "../lib/encrypting";
import { environmentExports } from "../lib/env";
import { proxyStateAtom, refreshProxyState, systemProxyEverOnAtom } from "../lib/store";
import {
  helperPollInterval,
  helperRow,
  recordingLabel,
  systemProxySwitch,
} from "../lib/systemProxy";
import { onWindowFocus } from "../lib/tauri";
import { useShowToast } from "../lib/toast";

/**
 * The header's state pill and its menu of four rows: the state, Pause or Resume Recording,
 * Override system proxy, and the certificate. The engine runs for as long as the app does, so the
 * pill shows whether flows are being stored. A certificate that is not trusted steps out of the
 * menu beside the pill until it is. More… holds the rows that move to Settings until it exists.
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
  const setHelperDialogOpen = useSetAtom(helperDialogOpenAtom);
  const { caStatus, trust, systemProxy, setSystemProxy } = setup;
  const systemSwitch = useSystemProxySwitch(setup);

  const running = proxyState?.state === "running";
  const recording = proxyState?.recording !== false;
  const other = proxyState?.otherOwner ?? null;
  const port = proxyState?.port ?? other?.proxyPort ?? null;
  const untrusted = caStatus.data != null && !caStatus.data.trusted;
  // Traffic stored before encryption is being encrypted; the engine starts once it is.
  const encrypting = !running && other == null ? encryptingPercent(proxyState) : null;

  const stateRow =
    encrypting != null ? (
      <MenuRow
        icon={<LoadingIcon size="sm" className="text-text-subtle" />}
        title={`Encrypting stored traffic, ${encrypting}`}
        description="Traffic captured before this version is being encrypted on disk. Recording starts when it's done."
      />
    ) : other != null ? (
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

  // The rows that move to Settings, reachable here until it exists.
  const moreItems: DropdownItem[] = [
    {
      type: "content",
      hidden: systemProxy.data?.supported !== true,
      label: (
        <KeepMenuOpen className="block px-1.5 py-1.5">
          <Checkbox
            title={<span className="text-sm">Override system proxy at launch</span>}
            checked={proxyState?.systemProxyAtLaunch ?? true}
            disabled={setAtLaunch.isPending}
            onChange={(enabled) => setAtLaunch.mutate({ enabled })}
          />
        </KeepMenuOpen>
      ),
    },
    {
      type: "content",
      hidden: systemProxy.data?.supported !== true,
      label: systemProxy.data != null && (
        <HelperMenuRow
          status={systemProxy.data}
          onOpenDialog={() => {
            dropdownRef.current?.close?.();
            setHelperDialogOpen(true);
          }}
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
  ];

  const items: DropdownItem[] = [
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
                  macOS asks for your password each time until the helper is approved, under More.
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
    { type: "separator" },
    { label: "More…", icon: "settings", submenu: moreItems },
  ];

  return (
    <>
      <Dropdown ref={dropdownRef} items={items}>
        <Pill
          color={
            !running && other == null && encrypting == null && proxyState != null
              ? "warning"
              : undefined
          }
        >
          {encrypting != null ? (
            <>
              <LoadingIcon size="xs" />
              <span className="text-text">Encrypting</span>
              <span className="font-mono text-text-subtle">{encrypting}</span>
            </>
          ) : other != null ? (
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
function HelperMenuRow({
  status,
  onOpenDialog,
}: {
  status: SystemProxyStatus;
  onOpenDialog: () => void;
}) {
  const queryClient = useQueryClient();
  const unregister = useRpcMutation("helper_unregister", {
    onSuccess: (status) =>
      queryClient.setQueryData<SystemProxyStatus>(["system_proxy_status", {}], status),
  });
  const row = helperRow(status.helper, status.backend);
  const error = unregister.error;
  return (
    <MenuRow
      icon={
        <Icon
          icon={status.helper === "enabled" ? "badge_check" : "lock"}
          size="sm"
          color={status.helper === "enabled" ? "success" : "secondary"}
        />
      }
      title={row.title}
      description={
        error != null ? <span className="text-danger">{error.message}</span> : row.description
      }
      action={
        row.action != null && (
          <Button
            size="2xs"
            variant="border"
            color={row.action === "unregister" ? "default" : "primary"}
            isLoading={unregister.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (row.action === "unregister") unregister.mutate({});
              else onOpenDialog();
            }}
          >
            {row.action === "install"
              ? "Install"
              : row.action === "approve"
                ? "Approve"
                : "Unregister"}
          </Button>
        )
      }
    />
  );
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

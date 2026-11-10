import { useQueryClient } from "@tanstack/react-query";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { HttpVersion, SystemProxyStatus, TrafficRetention } from "@yaakapp-internal/proxy-lib";
import {
  Button,
  Dialog,
  DialogFooter,
  Icon,
  RadioDropdown,
  SettingRow,
  SettingRowBoolean,
  PlainInput,
  SettingRowSelect,
  SettingSelectControl,
  SettingSnippet,
  SettingsList,
  SettingsPage,
  SettingsSection,
} from "@yaakapp-internal/ui";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useState } from "react";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { helperDialogOpenAtom } from "../lib/atoms";
import { confirmClearFlowsAtom } from "../lib/clearFlows";
import {
  defaultShell,
  environmentBlock,
  environmentVars,
  TERMINAL_SHELLS,
  type TerminalShell,
} from "../lib/env";
import {
  KEEP_TRAFFIC_OPTIONS,
  sizeFromOptionValue,
  sizeOptionsFor,
  sizeOptionValue,
} from "../lib/settings";
import { helperRow } from "../lib/systemProxy";
import { proxyStateAtom, refreshProxyState } from "../lib/store";
import { getOsType } from "../lib/tauri";
import { useShowToast } from "../lib/toast";
import { DecryptListEditor } from "./DecryptListEditor";

/**
 * The proxy's own settings tab: how it listens and the system proxy, what it decrypts, what
 * happens to captured traffic, and the environment for one terminal. Everything set once and
 * left alone, which is what left the state pill's menu.
 */
export function SettingsProxy() {
  const proxyState = useAtomValue(proxyStateAtom);
  const store = useStore();
  const refresh = { onSettled: () => void refreshProxyState(store) };
  const setHttpVersion = useRpcMutation("set_http_version", refresh);
  const setAtLaunch = useRpcMutation("set_system_proxy_at_launch", refresh);
  const systemProxy = useRpcQuery("system_proxy_status", {});
  // Another process owning the engine wouldn't see changes until it restarts
  const elsewhere = proxyState?.otherOwner != null;

  return (
    <SettingsPage title="Proxy" description="Listening, decryption, traffic and terminals">
      <SettingsList className="space-y-8">
        <SettingsSection title="Proxy">
          <PortRow disabled={elsewhere} />
          <SettingRowSelect<HttpVersion>
            name="httpVersion"
            title="HTTP version"
            description="For new connections"
            value={proxyState?.httpVersion ?? "auto"}
            disabled={elsewhere}
            onChange={(httpVersion) => setHttpVersion.mutate({ httpVersion })}
            options={[
              { label: "Auto", value: "auto" },
              { label: "HTTP/1.1 only", value: "http1Only" },
            ]}
          />
          {systemProxy.data?.supported === true && (
            <>
              <SettingRowBoolean
                title="Override system proxy"
                description="At launch"
                checked={proxyState?.systemProxyAtLaunch ?? true}
                disabled={setAtLaunch.isPending}
                onChange={(enabled) => setAtLaunch.mutate({ enabled })}
              />
              <HelperRow status={systemProxy.data} />
            </>
          )}
        </SettingsSection>

        <SettingsSection title="Decryption">
          <DecryptListEditor className="py-4" />
        </SettingsSection>

        <SettingsSection title="Traffic">
          <TrafficRow />
          {proxyState?.traffic === "keep" && <KeepTrafficRow />}
          <ConfirmClearRow />
          <ResetRow />
        </SettingsSection>

        <SettingsSection title="Terminal">
          <TerminalRow />
        </SettingsSection>
      </SettingsList>
    </SettingsPage>
  );
}

/** A port from 1 to 65535, or null */
function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port > 0 && port < 65536 ? port : null;
}

/**
 * The port, saved when the field is left or Enter is pressed rather than on each keystroke:
 * every save restarts a running proxy, so typing 8080 must not restart it on 8, 80 and 808.
 */
function PortRow({ disabled }: { disabled: boolean }) {
  const proxyState = useAtomValue(proxyStateAtom);
  const store = useStore();
  const showToast = useShowToast();
  const saved = proxyState?.configuredPort ?? 9090;
  const [draft, setDraft] = useState<string | null>(null);
  // Puts the saved port back in the field after a rejected or failed change
  const [resets, setResets] = useState(0);
  const reset = () => {
    setDraft(null);
    setResets((n) => n + 1);
  };
  const setPort = useRpcMutation("set_port", {
    onError: (err) => showToast({ message: err.message, color: "danger" }),
    onSettled: () => {
      reset();
      void refreshProxyState(store);
    },
  });
  const commit = () => {
    if (draft == null || setPort.isPending) return;
    const port = parsePort(draft);
    if (port == null || port === saved) {
      reset();
      return;
    }
    setPort.mutate({ port });
  };
  return (
    <SettingRow title="Port" description="Restarts the proxy">
      <PlainInput
        hideLabel
        size="sm"
        name="port"
        label="Port"
        type="number"
        containerClassName="w-48!"
        defaultValue={`${saved}`}
        forceUpdateKey={`${saved}.${resets}`}
        disabled={disabled || setPort.isPending}
        validate={(v) => parsePort(v) != null}
        onChange={setDraft}
        onBlur={commit}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </SettingRow>
  );
}

function HelperRow({ status }: { status: SystemProxyStatus }) {
  const queryClient = useQueryClient();
  const openDialog = useSetAtom(helperDialogOpenAtom);
  const unregister = useRpcMutation("helper_unregister", {
    onSuccess: (status) =>
      queryClient.setQueryData<SystemProxyStatus>(["system_proxy_status", {}], status),
  });
  const row = helperRow(status.helper, status.backend);
  return (
    <SettingRow
      title="Helper"
      description={
        unregister.error != null ? (
          <span className="text-danger">{unregister.error.message}</span>
        ) : (
          `${capitalize(row.title.replace(/^Helper: /, ""))}. ${row.description}`
        )
      }
    >
      {row.action != null && (
        <Button
          size="xs"
          variant="border"
          color={row.action === "unregister" ? "default" : "primary"}
          isLoading={unregister.isPending}
          onClick={() => (row.action === "unregister" ? unregister.mutate({}) : openDialog(true))}
        >
          {row.action === "install"
            ? "Install"
            : row.action === "approve"
              ? "Approve"
              : "Unregister"}
        </Button>
      )}
    </SettingRow>
  );
}

/** Whether captured traffic is cleared as the app launches or kept between launches */
function TrafficRow() {
  const proxyState = useAtomValue(proxyStateAtom);
  const store = useStore();
  const setTraffic = useRpcMutation("set_traffic", {
    onSettled: () => void refreshProxyState(store),
  });
  return (
    <SettingRowSelect<TrafficRetention>
      name="traffic"
      title="Captured traffic"
      selectClassName="w-56!"
      value={proxyState?.traffic ?? "clearOnLaunch"}
      disabled={proxyState?.otherOwner != null}
      onChange={(traffic) => setTraffic.mutate({ traffic })}
      options={[
        { label: "Clear on launch", value: "clearOnLaunch" },
        { label: "Keep between launches", value: "keep" },
      ]}
    />
  );
}

/** The most traffic kept between launches, beside what is stored now */
function KeepTrafficRow() {
  const proxyState = useAtomValue(proxyStateAtom);
  const store = useStore();
  const size = useRpcQuery("get_storage_size", {}, { refetchInterval: 10_000 });
  const setKeep = useRpcMutation("set_keep_traffic", {
    onSettled: () => void refreshProxyState(store),
  });
  const keep = proxyState?.keepTrafficBytes ?? null;
  return (
    <SettingRow title="Size limit" description="Oldest flows dropped past it">
      <div className="flex items-center gap-3">
        {size.data != null && (
          <span className="text-sm text-text-subtle tabular-nums whitespace-nowrap">
            {formatSize(size.data.bytes)} used
          </span>
        )}
        <SettingSelectControl
          name="keepTraffic"
          label="Size limit"
          value={sizeOptionValue(keep)}
          disabled={proxyState?.otherOwner != null}
          onChange={(v) => setKeep.mutate({ bytes: sizeFromOptionValue(v) })}
          options={sizeOptionsFor(KEEP_TRAFFIC_OPTIONS, keep).map(({ label, value }) => ({
            label,
            value,
          }))}
        />
      </div>
    </SettingRow>
  );
}

/** Asking before Clear, which its dialog's "Don't ask again" turns off */
function ConfirmClearRow() {
  const [confirm, setConfirm] = useAtom(confirmClearFlowsAtom);
  return (
    <SettingRowBoolean title="Confirm before clearing" checked={confirm} onChange={setConfirm} />
  );
}

function ResetRow() {
  const [confirming, setConfirming] = useState(false);
  const store = useStore();
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const reset = useRpcMutation("reset_captured_data", {
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries();
      showToast({ message: "Captured data reset" });
    },
    onSettled: () => void refreshProxyState(store),
  });
  return (
    <SettingRow title="Reset captured data" description="Deletes all flows and their keys">
      <Button size="xs" variant="border" color="danger" onClick={() => setConfirming(true)}>
        Reset…
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Reset captured data?"
        description="Every captured flow and the keys that encrypt them are deleted."
      >
        {reset.error != null && <p className="text-danger text-sm">{reset.error.message}</p>}
        <DialogFooter
          actions={[
            { label: "Cancel", variant: "border", onClick: () => setConfirming(false) },
            {
              label: "Reset",
              color: "danger",
              isLoading: reset.isPending,
              onClick: () => reset.mutate({}),
            },
          ]}
        />
      </Dialog>
    </SettingRow>
  );
}

function TerminalRow() {
  const proxyState = useAtomValue(proxyStateAtom);
  const caStatus = useRpcQuery("ca_status", {});
  const showToast = useShowToast();
  const os = getOsType();
  const [shell, setShell] = useState<TerminalShell>(() => defaultShell(os));
  const openTerminal = useRpcMutation("open_terminal", {
    onError: (err) => showToast({ message: err.message, color: "danger" }),
  });
  const port =
    proxyState?.port ?? proxyState?.otherOwner?.proxyPort ?? proxyState?.configuredPort ?? 9090;
  const caPath = caStatus.data?.certPath;
  const shellLabel = TERMINAL_SHELLS.find((s) => s.value === shell)?.label ?? shell;

  return (
    <div className="py-4">
      <div className="flex items-center gap-2">
        <span className="text-text">Environment</span>
        <RadioDropdown
          value={shell}
          onChange={(v) => setShell(v as TerminalShell)}
          items={TERMINAL_SHELLS.map((s) => ({ label: s.label, value: s.value }))}
        >
          <Button
            size="2xs"
            variant="border"
            title="Shell"
            rightSlot={<Icon icon="chevron_down" size="xs" className="ml-1" />}
          >
            {shellLabel}
          </Button>
        </RadioDropdown>
        <Button
          size="2xs"
          variant="border"
          className="ml-auto"
          title={
            os === "macos"
              ? "A new Terminal window with these set"
              : "Not available on this platform yet"
          }
          disabled={caPath == null || os !== "macos"}
          isLoading={openTerminal.isPending}
          onClick={() =>
            caPath != null && openTerminal.mutate({ vars: environmentVars(port, caPath) })
          }
        >
          Open Terminal
        </Button>
      </div>
      <p className="mt-1 text-sm text-text-subtle">Proxies one terminal instead of the system</p>
      {caPath != null && (
        <SettingSnippet
          className="mt-3"
          language="text"
          snippet={environmentBlock(shell, port, caPath)}
        />
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

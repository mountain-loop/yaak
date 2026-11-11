import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { useQueryClient } from "@tanstack/react-query";
import type { Flow, PassthroughResponse } from "@yaakapp-internal/proxy-lib";
import {
  Button,
  Dropdown,
  formatMillis,
  Icon,
  IconButton,
  type IconProps,
  InlineCode,
  Tooltip,
  CONTROL_TOOLTIP_DELAY,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { type ReactNode, useEffect, useState } from "react";
import { canTrustHere, useDecrypt, usePassthrough, useTrustCertificate } from "../hooks/useDecrypt";
import { useDecryptList } from "../hooks/useDecryptList";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import {
  type CardAction,
  connectionOf,
  encryptedCard,
  isOpen,
  isRejection,
  type Line,
} from "../lib/encryptedCard";
import { useFlowActions } from "../lib/flowActions";
import { utcTimestamp } from "../lib/flowViews";
import { useShowToast } from "../lib/toast";
import { AppIcon } from "./AppIcon";
import { useCopyEnvironment } from "./ProxyStatus";

/**
 * The card for HTTPS the proxy did not decrypt, or a client's refused handshake: the flow card's
 * header lines, with ENCRYPTED or REJECTED where the status goes, then why in one line and the
 * changes that would decrypt the next connection like it, each showing the entry it writes.
 */
export function EncryptedCard({ flow }: { flow: Flow }) {
  const list = useDecryptList();
  const caStatus = useRpcQuery("ca_status", {});
  const passthrough = usePassthrough();
  const rejection = isRejection(flow);
  // A tunnel passed through after a rejection names the client that refused.
  const rejectedById = flow.tlsRejected == null ? flow.tunnelRejectedBy : null;
  const rejectedBy = useRpcQuery(
    "get_flows",
    { ids: rejectedById == null ? [] : [rejectedById] },
    { enabled: rejectedById != null },
  ).data?.[0];
  const model = encryptedCard({
    flow,
    list,
    trusted: caStatus.data?.trusted ?? null,
    canTrust: canTrustHere(),
    passthrough,
    rejectedBy,
  });
  const { apply, trusting } = useDecrypt();
  const trust = useTrustCertificate();
  const copyEnvironment = useCopyEnvironment();
  const showToast = useShowToast();
  const fail = (err: Error) =>
    showToast({ id: "encrypted-card", color: "danger", message: err.message });
  const queryClient = useQueryClient();
  // Read from the answer too: an engine the CLI owns tells this app nothing of the change.
  const forget = useRpcMutation("forget_passthrough", {
    onError: fail,
    onSuccess: ({ addresses }) =>
      queryClient.setQueryData<PassthroughResponse>(["list_passthrough", {}], { addresses }),
  });
  const reconnect = useRpcMutation("reconnect_tunnels", { onError: fail });
  const connection = connectionOf(flow);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: CardAction) => {
    switch (action.kind) {
      case "decrypt":
      case "stop":
        if (action.edit == null) return;
        setBusy(action.label);
        await apply({
          edit: action.edit,
          message: action.toast?.message ?? action.label,
          sub: action.toast?.sub,
        });
        setBusy(null);
        return;
      case "reconnect":
        reconnect.mutate({ flowId: flow.id });
        return;
      case "trust":
        trust.mutate({});
        return;
      case "try_again":
        forget.mutate({ address: connection.address });
        return;
      case "copy_environment":
        await copyEnvironment();
        forget.mutate({ address: connection.address });
        return;
    }
  };

  return (
    <div className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)] min-h-0">
      <div
        className={classNames(
          "flex items-center gap-2 px-3 min-h-[calc(var(--height-sm)+0.25rem)]",
          "font-mono text-sm whitespace-nowrap overflow-x-auto hide-scrollbars",
        )}
      >
        <Icon
          icon={rejection ? "shield_off" : "lock"}
          size="sm"
          className={rejection ? "text-warning" : "text-text-subtlest"}
        />
        <span className="text-text select-text cursor-text">
          {connection.host.includes(":") ? `[${connection.host}]` : connection.host}
          <span className="text-text-subtlest">:{connection.port}</span>
        </span>
      </div>
      <StatusLine flow={flow} rejected={flow.tlsRejected != null} />
      <div className="mx-3 border-t border-border-subtle overflow-auto">
        <div className="mx-auto max-w-[27rem] py-10 grid gap-2">
          <div className="text-sm text-text mb-1">
            <LineText line={model.why} />
            <Tooltip wrap content={model.tooltip ?? ABOUT} delay={CONTROL_TOOLTIP_DELAY}>
              <IconButton
                size="2xs"
                icon="info"
                iconColor="secondary"
                title="About decryption"
                className="ml-1 align-middle inline-flex!"
              />
            </Tooltip>
          </div>
          {model.actions.map((action) => (
            <ActionButton
              key={action.label}
              action={
                busy === action.label && trusting
                  ? { ...action, label: "Waiting for macOS" }
                  : action
              }
              flow={flow}
              loading={
                busy === action.label ||
                (action.kind === "trust" && trust.isPending) ||
                (action.kind === "try_again" && forget.isPending) ||
                (action.kind === "reconnect" && reconnect.isPending)
              }
              disabled={busy != null && busy !== action.label}
              onClick={() => void run(action)}
            />
          ))}
          {model.foot.length > 0 && (
            <div className="text-xs text-text-subtlest mt-0.5">{model.foot.join(" ")}</div>
          )}
          {flow.error != null && flow.tlsRejected == null && (
            <div className="text-xs text-danger mt-1">{flow.error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the info button beside the why line says */
const ABOUT =
  "HTTPS is encrypted between the app and the server. Yaak Proxy shows requests only for hosts and apps you decrypt, from their next connection on.";

/** A why or fact line, its hosts, apps and entries shown as code */
function LineText({ line }: { line: Line }) {
  return (
    <>
      {line.map((part, i) =>
        typeof part === "string" ? (
          // oxlint-disable-next-line react/no-array-index-key -- the parts of one fixed line
          <span key={i}>{part}</span>
        ) : "bold" in part ? (
          // oxlint-disable-next-line react/no-array-index-key -- the parts of one fixed line
          <span key={i} className="font-semibold">
            {part.bold}
          </span>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- the parts of one fixed line
          <InlineCode key={i}>{part.code}</InlineCode>
        ),
      )}
    </>
  );
}

const ICONS: Record<Exclude<CardAction["icon"], "app">, IconProps["icon"]> = {
  host: "globe",
  everything: "layers",
  lock: "lock",
  lock_open: "lock_open",
  refresh: "refresh",
  shield: "shield",
  terminal: "square_terminal",
};

function ActionButton({
  action,
  flow,
  loading,
  disabled,
  onClick,
}: {
  action: CardAction;
  flow: Flow;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const icon: ReactNode =
    action.icon === "app" ? (
      flow.clientPath == null ? (
        <Icon icon="box" size="sm" />
      ) : (
        <AppIcon path={flow.clientPath} className="size-4 min-w-4" />
      )
    ) : (
      <Icon icon={ICONS[action.icon]} size="sm" />
    );
  return (
    <Button
      size="xs"
      variant="border"
      color={action.primary ? "primary" : "default"}
      justify="start"
      className={classNames("w-full", action.dashed && "border-dashed!")}
      isLoading={loading}
      disabled={disabled}
      leftSlot={loading ? undefined : icon}
      rightSlot={
        action.hint == null ? undefined : (
          <span
            className={classNames(
              "block ml-auto pl-3 font-mono text-xs text-text-subtlest truncate max-w-[11rem]",
              action.removes && "line-through",
            )}
          >
            {action.hint}
          </span>
        )
      }
      onClick={onClick}
    >
      {action.label}
    </Button>
  );
}

/** ENCRYPTED or REJECTED, the duration, or how long it has been open, and the bytes each way */
function StatusLine({ flow, rejected }: { flow: Flow; rejected: boolean }) {
  const flowActions = useFlowActions();
  const open = isOpen(flow);
  const openFor = useOpenFor(flow, open);
  return (
    <div
      className={classNames(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center pl-3",
        "min-h-[calc(var(--height-sm)+0.25rem)] font-mono text-sm text-text-subtle whitespace-nowrap",
      )}
    >
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbars">
        <span className={rejected ? "text-warning" : undefined}>
          {rejected ? "REJECTED" : "ENCRYPTED"}
        </span>
        <span>&bull;</span>
        {open ? (
          <span>open {openFor == null ? "" : formatMillis(openFor)}</span>
        ) : (
          <>
            <span>{flow.elapsedMs == null ? "--" : formatMillis(flow.elapsedMs)}</span>
            <span>&bull;</span>
            <span className="flex items-center gap-1">
              <Icon icon="arrow_up" size="xs" className="text-text-subtlest" />
              {formatSize(flow.requestSize)}
              <Icon icon="arrow_down" size="xs" className="text-text-subtlest ml-1" />
              {formatSize(flow.responseSize)}
            </span>
          </>
        )}
      </div>
      <div className="m-0.5 pr-2.5">
        <Dropdown items={flowActions(flow).slice(2)}>
          <IconButton size="sm" icon="ellipsis" iconColor="secondary" title="Actions" tooltip />
        </Dropdown>
      </div>
    </div>
  );
}

/** How long an open tunnel has been open, ticking each second */
function useOpenFor(flow: Flow, open: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const started = Date.parse(utcTimestamp(flow.startedAt));
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

import { useQueryClient } from "@tanstack/react-query";
import type { CaStatus } from "@yaakapp-internal/proxy-lib";
import { Button, Dropdown, type DropdownItem, type DropdownRef, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useRef } from "react";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { useRpcQueryWithEvent } from "../hooks/useRpcQueryWithEvent";

/** The header's state pill and its menu, with the certificate stepping out when untrusted */
export function ProxyStatus() {
  const queryClient = useQueryClient();
  const dropdownRef = useRef<DropdownRef>(null);
  const { data: proxyState } = useRpcQueryWithEvent("get_proxy_state", {}, "proxy_state_changed");
  const caStatus = useRpcQuery("ca_status", {});
  const trust = useRpcMutation("ca_trust", {
    onSuccess: (status) => queryClient.setQueryData<CaStatus>(["ca_status", {}], status),
  });
  const execute = useRpcMutation("execute_action");
  const running = proxyState?.state === "running";
  const port = proxyState?.port;
  const untrusted = caStatus.data != null && !caStatus.data.trusted;

  const items: DropdownItem[] = [
    {
      type: "content",
      label: (
        <MenuRow
          icon={<StateDot running={running} />}
          title={running && port != null ? `Running on port ${port}` : "Stopped"}
          description={
            running
              ? "Listening on 127.0.0.1."
              : "Start the proxy to capture traffic from apps pointed at it."
          }
        />
      ),
    },
    { type: "separator" },
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
      label: running ? "Stop Proxy" : "Start Proxy",
      icon: running ? "circle_stop" : "circle_play",
      hotKeyAction: running ? "proxy_stop" : "proxy_start",
      hotKeyLabelOnly: true,
      onSelect: () => {
        execute.mutate({ scope: "global", action: running ? "proxy_stop" : "proxy_start" });
      },
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
        <Pill>
          {running ? (
            <>
              <StateDot running />
              <span className="text-text">Running</span>
              {port != null && <span className="font-mono text-text-subtle">:{port}</span>}
            </>
          ) : (
            <>
              <StateDot running={false} />
              Stopped
            </>
          )}
          <Icon icon="chevron_down" size="xs" className="text-text-subtlest" />
        </Pill>
      </Dropdown>
    </>
  );
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

function StateDot({ running }: { running: boolean }) {
  return (
    <span
      aria-hidden
      className={classNames(
        "inline-block w-[7px] h-[7px] rounded-full shrink-0",
        running ? "bg-success ring-3 ring-success/20" : "border-[1.5px] border-text-subtlest",
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
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3 items-start px-1.5 py-1">
      <span className="h-5 flex items-center justify-center">{icon}</span>
      <div>
        <div className="text-sm text-text">{title}</div>
        <div className="text-xs text-text-subtle mt-0.5">{description}</div>
      </div>
      <span className="self-center">{action}</span>
    </div>
  );
}

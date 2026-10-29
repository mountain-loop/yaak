import { Button, Icon, LoadingIcon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { proxyStateAtom } from "../lib/store";
import { useCopyEnvironment, useProxySetup } from "./ProxyStatus";

type StepState = "todo" | "next" | "wait" | "done" | "fail";

/**
 * The list's empty state until traffic arrives: trust the certificate, turn on the system proxy,
 * then see traffic. Not dismissable and nothing remembered; the first flow replaces it. Copy
 * environment beside it serves someone who wants one terminal proxied and nothing system-wide.
 */
export function FirstRun() {
  const proxyState = useAtomValue(proxyStateAtom);
  const { caStatus, trust, systemProxy, setSystemProxy } = useProxySetup();
  const execute = useRpcMutation("execute_action");
  const copyEnvironment = useCopyEnvironment();

  const running = proxyState?.state === "running" || proxyState?.otherOwner != null;
  const port = proxyState?.port ?? proxyState?.otherOwner?.proxyPort ?? proxyState?.configuredPort;
  const trusted = caStatus.data?.trusted === true;
  const systemSupported = systemProxy.data?.supported !== false;
  const systemOn = systemProxy.data?.enabled === true;

  const trustState: StepState = trusted
    ? "done"
    : trust.isPending
      ? "wait"
      : trust.error != null
        ? "fail"
        : "next";
  const systemState: StepState = systemOn
    ? "done"
    : setSystemProxy.isPending
      ? "wait"
      : setSystemProxy.error != null
        ? "fail"
        : trusted
          ? "next"
          : "todo";
  const trafficState: StepState =
    trusted && (systemOn || !systemSupported) ? (running ? "wait" : "next") : "todo";

  const turnOn = async () => {
    if (proxyState?.state !== "running" && proxyState?.otherOwner == null) {
      await execute.mutateAsync({ scope: "global", action: "proxy_start" });
    }
    setSystemProxy.mutate({ enabled: true });
  };

  return (
    <div className="grid place-items-center h-full px-10 pb-16 pt-6">
      <div className="w-full max-w-[40rem]">
        <div className="text-xl font-semibold mb-1.5">Set up Yaak Proxy</div>
        <div className="text-text-subtle text-sm leading-relaxed mb-4">
          Three steps, once. Afterwards every app on this Mac sends its traffic here, and HTTPS
          reads as plain text.
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface divide-y divide-border-subtle">
          <Step
            n={1}
            state={trustState}
            title={trusted ? "Certificate trusted" : "Trust the certificate"}
            description={
              trusted
                ? "Yaak Proxy CA, in your login keychain."
                : trustState === "wait"
                  ? "Waiting for your password in the macOS prompt."
                  : trustState === "fail"
                    ? (trust.error?.message ?? "The certificate was not trusted.")
                    : "So HTTPS reads as plain text. macOS asks for your login password once."
            }
            action={
              trustState === "next" || trustState === "fail" ? (
                <Button
                  size="2xs"
                  variant={trustState === "fail" ? "border" : "solid"}
                  color={trustState === "fail" ? "default" : "primary"}
                  onClick={() => trust.mutate({})}
                >
                  {trustState === "fail" ? "Try again" : "Trust certificate"}
                </Button>
              ) : null
            }
          />
          {systemSupported && (
            <Step
              n={2}
              state={systemState}
              title={
                systemOn
                  ? "System proxy on"
                  : systemState === "wait"
                    ? "Turning on the system proxy"
                    : "Turn on the system proxy"
              }
              description={
                systemOn
                  ? `${(systemProxy.data?.services ?? []).map((s) => s.name).join(" and ")} point at 127.0.0.1:${systemProxy.data?.port}.`
                  : systemState === "wait"
                    ? "Waiting for your password in the macOS prompt."
                    : systemState === "fail"
                      ? (setSystemProxy.error?.message ?? "The system proxy was not changed.")
                      : `Sends this Mac's web traffic through port ${port ?? 9090}. Turns off when Yaak Proxy quits.`
              }
              action={
                systemState === "next" || systemState === "fail" ? (
                  <Button
                    size="2xs"
                    variant={systemState === "fail" ? "border" : "solid"}
                    color={systemState === "fail" ? "default" : "primary"}
                    isLoading={execute.isPending}
                    onClick={() => void turnOn()}
                  >
                    {systemState === "fail" ? "Try again" : "Turn on"}
                  </Button>
                ) : null
              }
            />
          )}
          <Step
            n={systemSupported ? 3 : 2}
            state={trafficState}
            title={trafficState === "wait" ? "Waiting for traffic" : "See traffic"}
            description={
              trafficState === "wait"
                ? "Open a website or send a request, and its flow appears here."
                : running
                  ? "Flows appear here as apps send requests."
                  : "Start the proxy, and flows appear here as apps send requests."
            }
            action={
              trafficState === "next" ? (
                <Button
                  size="2xs"
                  color="primary"
                  isLoading={execute.isPending}
                  onClick={() => execute.mutate({ scope: "global", action: "proxy_start" })}
                >
                  Start proxy
                </Button>
              ) : null
            }
          />
        </div>
        <div className="flex items-center gap-3 mt-4 text-sm text-text-subtle">
          <span>Only need one terminal or one app? Copy the environment instead.</span>
          <Button
            size="2xs"
            variant="border"
            className="ml-auto shrink-0"
            leftSlot={<Icon icon="square_terminal" size="sm" />}
            onClick={() => void copyEnvironment()}
          >
            Copy environment
          </Button>
        </div>
        {execute.error != null && (
          <div className="mt-3 text-sm text-danger">{execute.error.message}</div>
        )}
      </div>
    </div>
  );
}

function Step({
  n,
  state,
  title,
  description,
  action,
}: {
  n: number;
  state: StepState;
  title: string;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.4rem_minmax(0,1fr)_auto] gap-x-3 items-center px-4 py-3">
      <StepMark n={n} state={state} />
      <div className="min-w-0">
        <div className={classNames("text-sm", state === "todo" ? "text-text-subtle" : "text-text")}>
          {title}
        </div>
        <div
          className={classNames(
            "text-xs mt-0.5",
            state === "fail" ? "text-danger" : "text-text-subtle",
          )}
        >
          {description}
        </div>
      </div>
      <div>{action}</div>
    </div>
  );
}

function StepMark({ n, state }: { n: number; state: StepState }) {
  const base = "w-[1.4rem] h-[1.4rem] rounded-full grid place-items-center text-xs";
  switch (state) {
    case "done":
      return (
        <span className={classNames(base, "bg-success/15 text-success")}>
          <Icon icon="check" size="sm" />
        </span>
      );
    case "fail":
      return (
        <span className={classNames(base, "bg-danger/15 text-danger")}>
          <Icon icon="x" size="sm" />
        </span>
      );
    case "wait":
      return (
        <span className={classNames(base, "text-text-subtle")}>
          <LoadingIcon size="sm" />
        </span>
      );
    case "next":
      return <span className={classNames(base, "bg-primary text-white font-semibold")}>{n}</span>;
    case "todo":
      return <span className={classNames(base, "border border-border text-text-subtle")}>{n}</span>;
  }
}

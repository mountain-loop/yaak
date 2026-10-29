import { Button, Icon } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { proxyStateAtom } from "../lib/store";

/**
 * A quiet strip while another process, the CLI daemon, owns the engine: flows still list, read
 * from the database, and Take over stops that process's proxy and starts this app's. Never done
 * without the person asking.
 */
export function TakeOverBanner() {
  const other = useAtomValue(proxyStateAtom)?.otherOwner;
  const takeOver = useRpcMutation("take_over");
  if (other == null) return null;
  const since = new Date(other.startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const cli = other.owner === "cli";
  const who = cli ? "Running from the CLI" : "Running in another Yaak Proxy";

  return (
    <div className="flex items-center gap-2.5 h-[2.2rem] mx-2 mb-1 pl-3 pr-1.5 rounded-md bg-surface-highlight/45 border border-border-subtle text-sm text-text-subtle min-w-0">
      <Icon icon="square_terminal" size="sm" color="info" className="shrink-0" />
      <span className="text-text shrink-0">{who}</span>
      {other.owner === "cli" && (
        <span className="font-mono text-xs text-text-subtlest shrink-0">yaak proxy start</span>
      )}
      <span className="truncate">
        {!cli ? (
          // Stopping another app halts its engine without releasing it, so it can't be taken over.
          "Another Yaak Proxy window owns the engine. Quit it to use this one."
        ) : takeOver.error != null ? (
          <span className="text-danger">{takeOver.error.message}</span>
        ) : (
          `pid ${other.pid}, since ${since}. Flows still list here, read from the capture database.`
        )}
      </span>
      {cli && (
        <Button
          size="2xs"
          variant="border"
          className="ml-auto shrink-0"
          isLoading={takeOver.isPending}
          onClick={() => takeOver.mutate({})}
        >
          Take over
        </Button>
      )}
    </div>
  );
}

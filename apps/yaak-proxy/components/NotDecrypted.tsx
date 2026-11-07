import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import { Button, formatMillis, Icon } from "@yaakapp-internal/ui";
import { useDecryptList, useEditDecryptList } from "../hooks/useDecryptList";
import { type DecryptSubject, detailActions, listEdit, setDecrypted } from "../lib/decrypt";
import { sidebarPath } from "../lib/search";
import { EmptyState } from "./FlowBodyViewer";

/**
 * The detail of HTTPS passed through undecrypted: its sizes and time, and buttons that add its
 * host or its app to the decrypt list, from the next connection on.
 */
export function NotDecrypted({ flow }: { flow: Flow }) {
  const list = useDecryptList();
  const save = useEditDecryptList();
  const host = sidebarPath(flow.url).split("/")[0] ?? flow.url;
  const hostSubject: DecryptSubject = { kind: "host", host };
  const appSubject: DecryptSubject | null =
    flow.clientName == null
      ? null
      : { kind: "app", name: flow.clientName, bundleId: flow.clientBundleId };
  const app = flow.clientName;
  const actions = detailActions(
    list,
    host,
    app == null ? null : { name: app, bundleId: flow.clientBundleId },
  );
  const open = flow.elapsedMs == null && flow.error == null;

  const decrypt = (subject: DecryptSubject) =>
    save.mutate(listEdit(list, setDecrypted(list, [subject], true)));

  const facts = [
    `${formatSize(Number(flow.requestSize))} sent`,
    `${formatSize(Number(flow.responseSize))} received`,
    open ? "open" : flow.elapsedMs == null ? null : formatMillis(flow.elapsedMs),
  ].filter((f) => f != null);

  return (
    <EmptyState>
      <div className="grid justify-items-center gap-2">
        <div className="flex items-center gap-1.5 text-text-subtle">
          <Icon icon="lock" size="sm" />
          Not decrypted
        </div>
        <div className="font-mono text-xs">{facts.join(" · ")}</div>
        {flow.error != null && <div className="text-danger">{flow.error}</div>}
        {actions.listed ? (
          <div title="Still tunnelled? The app may pin its certificate">
            Decrypting new connections
          </div>
        ) : actions.blocked != null ? (
          <div title="Remove it from the decrypt list to decrypt">
            Excluded by <span className="font-mono text-xs">{actions.blocked}</span>
          </div>
        ) : (
          <div className="flex gap-2 mt-1">
            {actions.host && (
              <Button
                size="xs"
                variant="border"
                title={`Decrypt new connections to ${host}`}
                disabled={save.isPending}
                onClick={() => decrypt(hostSubject)}
              >
                Decrypt Host
              </Button>
            )}
            {actions.app && appSubject != null && (
              <Button
                size="xs"
                variant="border"
                title={`Decrypt new connections from ${app}`}
                disabled={save.isPending}
                onClick={() => decrypt(appSubject)}
              >
                Decrypt App
              </Button>
            )}
          </div>
        )}
      </div>
    </EmptyState>
  );
}

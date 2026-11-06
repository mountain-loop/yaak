import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import { Button, formatMillis, Icon } from "@yaakapp-internal/ui";
import { useDecryptList, useSetDecryptList } from "../hooks/useDecryptList";
import {
  blockingExclusion,
  type DecryptSubject,
  decrypts,
  setDecrypted,
  subjectEntry,
  subjectQuery,
} from "../lib/decrypt";
import { sidebarPath } from "../lib/search";

/**
 * The detail of HTTPS passed through undecrypted: what was recorded of it, and buttons that add
 * its host, or its app, to the decrypt list. Adding takes effect from the next connection, as
 * this one was never read.
 */
export function NotDecrypted({ flow }: { flow: Flow }) {
  const list = useDecryptList();
  const save = useSetDecryptList();
  const host = sidebarPath(flow.url).split("/")[0] ?? flow.url;
  const hostSubject: DecryptSubject = { kind: "host", host };
  const appSubject: DecryptSubject | null =
    flow.clientName == null
      ? null
      : { kind: "app", name: flow.clientName, bundleId: flow.clientBundleId };
  const app = flow.clientName;
  // The connection whole: its host and port, and its app, as the engine judged it.
  const query = {
    ...subjectQuery(hostSubject),
    app: app == null ? null : { name: app, bundleId: flow.clientBundleId },
  };
  const listed = decrypts(list, query);
  // Its own exact exclusions, which Decrypt removes, aside.
  const own = new Set(
    [hostSubject, appSubject].map((s) => (s == null ? "" : `!${subjectEntry(s)}`)),
  );
  const blocked = listed
    ? null
    : blockingExclusion(
        list.filter((e) => !own.has(e.entry)),
        query,
      );
  const open = flow.elapsedMs == null && flow.error == null;

  const decrypt = (subject: DecryptSubject) =>
    save.mutate({ entries: setDecrypted(list, [subject], true).map((e) => e.entry) });

  return (
    <div className="h-full grid place-items-center px-6 py-8 overflow-auto">
      <div className="max-w-[30rem] w-full grid gap-3">
        <div className="flex items-center gap-2 text-text">
          <Icon icon="lock" className="text-text-subtle" />
          <span className="text-base font-semibold">Not decrypted</span>
        </div>
        <p className="text-sm text-text-subtle leading-relaxed">
          {app == null ? "This" : `${app}'s`} HTTPS connection to{" "}
          <span className="font-mono text-xs text-text">{host}</span> passed through as it was sent,
          so only its size and timing are recorded: {formatSize(Number(flow.requestSize))} sent,{" "}
          {formatSize(Number(flow.responseSize))} received
          {open
            ? ", still open."
            : flow.elapsedMs == null
              ? "."
              : ` over ${formatMillis(flow.elapsedMs)}.`}
        </p>
        {flow.error != null && <p className="text-sm text-danger">{flow.error}</p>}
        {listed ? (
          <p className="text-sm text-text-subtle leading-relaxed">
            The decrypt list covers it now, so new connections from {app ?? "the app"} to {host} are
            decrypted. If they still are not, the app rejected Yaak Proxy's certificate: it pins its
            own, or the certificate is not trusted yet.
          </p>
        ) : blocked != null ? (
          <p className="text-sm text-text-subtle leading-relaxed">
            <span className="font-mono text-xs text-text">{blocked}</span> in the decrypt list keeps
            it from being decrypted. Remove it from the list, under More… by the state, to decrypt
            it.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                color="primary"
                disabled={save.isPending}
                onClick={() => decrypt(hostSubject)}
              >
                Decrypt {host}
              </Button>
              {appSubject != null && (
                <Button
                  size="sm"
                  variant="border"
                  disabled={save.isPending}
                  onClick={() => decrypt(appSubject)}
                >
                  Decrypt everything from {app}
                </Button>
              )}
            </div>
            <p className="text-xs text-text-subtlest">
              New connections are decrypted from then on; this one stays as it was.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

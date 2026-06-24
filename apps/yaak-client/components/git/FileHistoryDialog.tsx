import { useGitFileDiffForCommit, useGitLog, useGitMutations } from "@yaakapp-internal/git";
import type { GitCommit } from "@yaakapp-internal/git";
import { InlineCode, SplitLayout } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { formatDistanceToNowStrict } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sync } from "../../init/sync";
import { showConfirm } from "../../lib/confirm";
import { EmptyStateText } from "../EmptyStateText";
import { Button } from "../core/Button";
import { DiffViewer } from "../core/Editor/DiffViewer";
import { useGitCallbacks } from "./callbacks";

export function FileHistoryDialog({ dir, relaPath }: { dir: string; relaPath: string }) {
  const callbacks = useGitCallbacks(dir);
  const { restoreFileFromCommit } = useGitMutations(dir, callbacks);
  const log = useGitLog(dir, undefined, relaPath);
  const commits = log.data ?? [];
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const selectedCommit = useMemo(
    () => commits.find((commit) => commit.oid === selectedOid) ?? null,
    [commits, selectedOid],
  );
  const diff = useGitFileDiffForCommit(dir, relaPath, selectedCommit?.oid);

  useEffect(() => {
    if (commits.length === 0) {
      setSelectedOid(null);
    } else if (selectedOid == null || !commits.some((commit) => commit.oid === selectedOid)) {
      setSelectedOid(commits[0]?.oid ?? null);
    }
  }, [commits, selectedOid]);

  const handleRestoreCommit = useCallback(
    async (commit: GitCommit) => {
      const confirmed = await showConfirm({
        id: "git-restore-file-history-entry",
        title: "Restore File",
        description: "This will restore the file to the selected commit.",
        confirmText: "Restore",
        color: "warning",
      });
      if (!confirmed) return;

      await restoreFileFromCommit.mutateAsync({ commitOid: commit.oid, relaPath });
      await sync({ force: true });
    },
    [relaPath, restoreFileFromCommit],
  );

  if (commits.length === 0 && !log.isLoading) {
    return <EmptyStateText>No history for this file</EmptyStateText>;
  }

  return (
    <div className="h-full px-2 pb-4">
      <SplitLayout
        storageKey="git-file-history-horizontal"
        layout="horizontal"
        defaultRatio={0.6}
        firstSlot={({ style }) => (
          <div style={style} className="h-full overflow-y-auto px-4 pb-2 transform-cpu">
            <div className="flex flex-col pt-1.5">
              {commits.map((commit) => (
                <CommitListItem
                  key={commit.oid}
                  commit={commit}
                  selected={commit.oid === selectedCommit?.oid}
                  onSelect={() => setSelectedOid(commit.oid)}
                />
              ))}
            </div>
          </div>
        )}
        secondSlot={({ style }) => (
          <div style={style} className="h-full min-w-0 border-l border-l-border-subtle px-4">
            {selectedCommit == null ? (
              <EmptyStateText>Select a commit to view diff</EmptyStateText>
            ) : (
              <div className="h-full flex flex-col">
                <div className="mb-2 min-w-0 text-text-subtle grid items-center gap-2 grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0 truncate">{selectedCommit.message || "No message"}</div>
                  <Button
                    className="ml-auto"
                    color="warning"
                    size="2xs"
                    variant="border"
                    onClick={() => handleRestoreCommit(selectedCommit)}
                  >
                    Restore File
                  </Button>
                </div>
                <DiffViewer
                  original={diff.data?.original ?? ""}
                  modified={diff.data?.modified ?? ""}
                  className="flex-1 min-h-0"
                />
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}

function CommitListItem({
  commit,
  selected,
  onSelect,
}: {
  commit: GitCommit;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "w-full min-w-0 text-left rounded px-2 py-1.5",
        selected && "bg-surface-active",
      )}
      onClick={onSelect}
    >
      <div className="truncate flex-1">{commit.message || "No message"}</div>
      <div className="text-text-subtle text-sm truncate">
        {commit.author.name || "Unknown"} - {formatDistanceToNowStrict(commit.when)} ago - <span className="shrink-0 text-2xs text-text-subtle font-mono">{commit.oid.slice(0, 7)}</span>
      </div>
    </button>
  );
}

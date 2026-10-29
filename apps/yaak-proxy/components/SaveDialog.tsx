import type {
  DropReason,
  Flow,
  FolderSummary,
  WorkspaceSummary,
} from "@yaakapp-internal/proxy-lib";
import { Banner, Button, HttpMethodTagRaw, LoadingIcon } from "@yaakapp-internal/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "react-use";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { exportHar, saveDialogFlowAtom } from "../lib/flowActions";
import { showToastAtom } from "../lib/toast";
import { Dialog } from "./Dialog";

const DOWNLOAD_URL = "https://yaak.app/download";

/** Save as Yaak request, for the flow in `saveDialogFlowAtom` */
export function SaveDialog() {
  const [flow, setFlow] = useAtom(saveDialogFlowAtom);
  const workspaces = useRpcQuery("list_workspaces", {}, { enabled: flow != null, staleTime: 0 });
  const close = () => setFlow(null);

  if (flow == null) return null;
  if (workspaces.data?.yaakFound === false) return <NoYaakDialog flow={flow} onClose={close} />;
  return (
    <Dialog
      open
      onClose={close}
      title="Save as Yaak request"
      description="A new request in Yaak with this flow's method, URL, headers and body."
      className="w-[36rem]"
    >
      {workspaces.error != null ? (
        <Banner color="danger">{workspaces.error.message}</Banner>
      ) : workspaces.data == null ? (
        <LoadingIcon />
      ) : (
        <SaveForm flow={flow} workspaces={workspaces.data.workspaces} onClose={close} />
      )}
    </Dialog>
  );
}

function SaveForm({
  flow,
  workspaces,
  onClose,
}: {
  flow: Flow;
  workspaces: WorkspaceSummary[];
  onClose: () => void;
}) {
  const showToast = useSetAtom(showToastAtom);
  const preview = useRpcQuery("preview_save", { flowId: flow.id }, { staleTime: 0 });
  const [lastWorkspaceId, setLastWorkspaceId] = useLocalStorage<string>("save_workspace_id");
  const [workspaceId, setWorkspaceId] = useState(
    workspaces.find((w) => w.id === lastWorkspaceId)?.id ?? workspaces[0]?.id ?? "",
  );
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState<string | null>(null);
  const save = useRpcMutation("save_flow");

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const folders = useMemo(() => folderOptions(workspace?.folders ?? []), [workspace]);
  useEffect(() => setFolderId(""), [workspaceId]);

  const p = preview.data;
  const shownName = name ?? p?.name ?? "";
  const folderName = folders.find((f) => f.id === folderId)?.name;

  const submit = () => {
    if (workspace == null) return;
    save.mutate(
      {
        flowId: flow.id,
        workspaceId: workspace.id,
        ...(folderId === "" ? {} : { folderId }),
        name: shownName,
      },
      {
        onSuccess: (saved) => {
          setLastWorkspaceId(workspace.id);
          onClose();
          showToast({
            message: (
              <>
                Saved <b className="font-semibold">{saved.name}</b> to {workspace.name}
                {folderName == null ? "." : `, in ${folderName}.`} Yaak picks it up within a second.
              </>
            ),
          });
        },
      },
    );
  };

  if (workspaces.length === 0) {
    return (
      <Banner color="notice">
        Yaak has no workspaces yet. Create one in Yaak, then save here.
      </Banner>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3 h-sm px-2.5 rounded-md border border-border-subtle font-mono text-sm min-w-0">
        <HttpMethodTagRaw method={flow.method} colored />
        <span className="truncate text-text">{flow.url}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Workspace">
          <select
            className={inputClasses}
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Folder">
          <select
            className={inputClasses}
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name">
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the one field to change
          autoFocus
          className={inputClasses}
          value={shownName}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {preview.error != null && <Banner color="danger">{preview.error.message}</Banner>}
      {p != null && p.droppedHeaders.length > 0 && (
        <div className="rounded-md border border-border-subtle px-3.5 py-2.5">
          <div className="text-sm text-text">
            {p.droppedHeaders.length === 1
              ? "1 header left out"
              : `${p.droppedHeaders.length} headers left out`}{" "}
            <span className="text-text-subtlest text-xs">
              {droppedSummary(p.droppedHeaders.map((h) => h.reason))}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {p.droppedHeaders.map((h) => (
              <span
                key={h.name}
                title={`${h.name}: ${h.value}\n${reasonLabel(h.reason)}`}
                className="font-mono text-xs leading-[22px] px-1.5 rounded-sm border border-border-subtle text-text-subtle line-through decoration-text-subtlest"
              >
                {h.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {p != null && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-sm">
          <span className="text-text-subtle">Kept</span>
          <span>
            {p.keptHeaders === 1 ? "1 header" : `${p.keptHeaders} headers`}
            {p.body == null ? ", and no body" : `, and the body as ${p.body}`}
          </span>
          {p.warnings.map((w) => (
            <NoteRow key={w} warning={w} authorization={p.authorization} />
          ))}
        </div>
      )}
      {save.error != null && <Banner color="danger">{save.error.message}</Banner>}
      <div className="flex items-center gap-2 pt-1">
        <span className="mr-auto text-xs text-text-subtlest">Yaak picks it up within a second</span>
        <Button variant="border" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          color="primary"
          isLoading={save.isPending}
          disabled={workspace == null || preview.data == null}
        >
          Save request
        </Button>
      </div>
    </form>
  );
}

function NoteRow({ warning, authorization }: { warning: string; authorization: boolean }) {
  const flagged = authorization && warning.includes("Authorization");
  return (
    <>
      <span className="text-text-subtle">Note</span>
      <span className={flagged ? "text-notice" : "text-text-subtle"}>{warning}</span>
    </>
  );
}

/** Without Yaak there is nothing to save into: say so, and offer HAR as a way to keep the flow */
function NoYaakDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const showToast = useSetAtom(showToastAtom);
  return (
    <Dialog
      open
      onClose={onClose}
      className="w-[32rem]"
      footer={
        <>
          <span className="mr-auto text-xs text-text-subtlest">Or keep the flow as a file</span>
          <Button
            variant="border"
            onClick={async () => {
              try {
                if ((await exportHar({ ids: [flow.id] }, "flow.har")) != null) {
                  onClose();
                  showToast({ message: "Exported the flow as HAR" });
                }
              } catch (err) {
                showToast({ message: `Failed to export HAR: ${String(err)}`, color: "danger" });
              }
            }}
          >
            Export HAR
          </Button>
          <Button color="primary" onClick={() => void openUrl(DOWNLOAD_URL)}>
            Download Yaak
          </Button>
        </>
      }
    >
      <div className="pt-3">
        <div className="text-lg font-semibold mb-1.5">Saving needs Yaak</div>
        <div className="text-sm text-text-subtle leading-relaxed">
          This flow becomes a request in one of Yaak's workspaces, and Yaak has not been opened on
          this Mac. Yaak is free for personal use and opens the request with the same viewers you
          see here.
        </div>
      </div>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- wraps its control
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-text-subtle">{label}</span>
      {children}
    </label>
  );
}

const inputClasses =
  "h-sm w-full min-w-0 px-2 rounded-md border border-border bg-surface text-text text-sm outline-hidden focus:border-border-focus";

/** Folders by their path within the workspace, "Stripe / Payments", in path order */
function folderOptions(folders: FolderSummary[]): { id: string; name: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (f: FolderSummary): string => {
    const names = [f.name];
    const seen = new Set([f.id]);
    let parent = f.folderId == null ? undefined : byId.get(f.folderId);
    while (parent != null && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.folderId == null ? undefined : byId.get(parent.folderId);
    }
    return names.join(" / ");
  };
  return folders
    .map((f) => ({ id: f.id, name: pathOf(f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function reasonLabel(reason: DropReason): string {
  switch (reason) {
    case "set_by_sending":
      return "Yaak sets it when it sends";
    case "hop_by_hop":
      return "Only meant for the proxy";
    case "body_decoded":
      return "The body is saved decoded";
  }
}

function droppedSummary(reasons: DropReason[]): string {
  const unique = [...new Set(reasons)];
  if (unique.length === 1 && unique[0] === "set_by_sending") {
    return "Yaak sets these itself when it sends";
  }
  return "Yaak sets these itself, or they only meant something to the proxy";
}

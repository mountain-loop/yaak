import {
  type Folder,
  type ImportDestination,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSource,
  type Workspace,
} from "@yaakapp-internal/models";
import { HStack, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { platform } from "@yaakapp-internal/platform";
import classNames from "classnames";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { pluralize } from "../lib/pluralize";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import type { CheckboxTreeNode } from "./core/CheckboxTree";
import { CheckboxTree } from "./core/CheckboxTree";
import { IconTooltip } from "./core/IconTooltip";
import { PlainInput } from "./core/PlainInput";
import { Select } from "./core/Select";
import { SegmentedControl } from "./core/SegmentedControl";

interface Props {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  selectedFolder: Folder | null;
  planFile: (filePath: string, destination: ImportDestination) => Promise<ImportPlan>;
  planUrl: (url: string, destination: ImportDestination) => Promise<ImportPlan>;
  listSources: (workspaceId: string) => Promise<ImportSource[]>;
  findSourcesForOrigin: (args: { filePath?: string; url?: string }) => Promise<ImportSource[]>;
  commit: (plan: ImportPlan) => Promise<void>;
  cancel: () => void;
  onError: (err: unknown) => void;
}

/**
 * An absolute or relative path is unambiguously a file. Everything else is treated as a URL, so a
 * bare host like `example.com/openapi.json` still works (the backend defaults it to https).
 */
function isFilePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) || path;
}

/**
 * Loads the current workspace's linked sources before rendering the dialog, so the inner
 * component can construct its initial state (prefilled path, destination) in one pass instead of
 * patching it in with effects after the first paint.
 */
export function ImportDataDialog(props: Props) {
  const [initialSources, setInitialSources] = useState<ImportSource[] | null>(null);
  const { currentWorkspace, listSources } = props;

  useEffect(() => {
    let cancelled = false;
    const load = currentWorkspace == null ? Promise.resolve([]) : listSources(currentWorkspace.id);
    load
      .then((sources) => {
        if (!cancelled) setInitialSources(sources);
      })
      .catch(() => {
        if (!cancelled) setInitialSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentWorkspace, listSources]);

  if (initialSources == null) return null;
  return <LoadedImportDataDialog {...props} initialSources={initialSources} />;
}

function latestSource(sources: ImportSource[]): ImportSource | null {
  return sources.reduce<ImportSource | null>(
    (latest, s) => (latest == null || s.lastImportedAt > latest.lastImportedAt ? s : latest),
    null,
  );
}

function LoadedImportDataDialog({
  currentWorkspace,
  workspaces,
  selectedFolder,
  planFile,
  planUrl,
  listSources,
  findSourcesForOrigin,
  commit,
  cancel,
  onError,
  initialSources,
}: Props & { initialSources: ImportSource[] }) {
  // A workspace with a linked source is probably being re-imported, so start from that source
  const prefill = latestSource(initialSources);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [items, setItems] = useState<ImportPlanItem[]>([]);
  // null means no explicit choice yet, so the default below applies
  const [destinationChoice, setDestinationChoice] = useState<"new" | "current" | "other" | null>(
    null,
  );
  const [otherWorkspaceId, setOtherWorkspaceId] = useState<string | null>(null);
  const [targetSelectedFolder, setTargetSelectedFolder] = useState(selectedFolder != null);
  const [linkedSources, setLinkedSources] = useState<ImportSource[]>(
    prefill != null ? initialSources : [],
  );
  const [originSources, setOriginSources] = useState<ImportSource[]>(
    prefill != null ? [prefill] : [],
  );
  // A file path or a URL. Both inputs write here, so there is only ever one thing to import
  const [source, setSource] = useState<string | null>(prefill?.origin ?? null);
  const [forceUpdateKey, setForceUpdateKey] = useState<number>(0);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);
  const trimmedSource = source?.trim() ?? "";
  const filePath = isFilePath(trimmedSource) ? trimmedSource : null;

  const selectSource = (value: string) => {
    setSource(value);
    // Remount the input so it shows the path of the newly-picked file
    setForceUpdateKey((k) => k + 1);
  };

  // Accept a file dropped anywhere on the dialog, the way SelectFile does for its button
  useEffect(() => {
    return platform.window.onDragDrop((event) => {
      if (event.type === "over") {
        const p = event.position;
        const r = ref.current?.getBoundingClientRect();
        if (r == null) return;
        setIsHovering(p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);
      } else if (event.type === "drop" && isHovering) {
        const p = event.paths[0];
        if (p) selectSource(p);
        setIsHovering(false);
      } else {
        setIsHovering(false);
      }
    });
  }, [isHovering, setSource]);

  useEffect(() => {
    if (trimmedSource === "") {
      setOriginSources([]);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      findSourcesForOrigin(filePath != null ? { filePath } : { url: trimmedSource })
        .then((sources) => {
          if (!cancelled) setOriginSources(sources);
        })
        .catch(() => setOriginSources([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [trimmedSource, filePath, findSourcesForOrigin]);

  // The one workspace this file is linked to, if there is exactly one.
  const linkedWorkspace = useMemo(() => {
    const ids = [...new Set(originSources.map((s) => s.workspaceId))];
    if (ids.length !== 1) return null;
    return workspaces.find((w) => w.id === ids[0]) ?? null;
  }, [originSources, workspaces]);

  // A file linked to the current workspace defaults back into it, so re-importing doesn't
  // accidentally create a duplicate workspace. A file linked elsewhere only gets a suggestion —
  // silently targeting a workspace that is neither new nor current is too surprising. An
  // explicit choice always wins.
  const destinationKind =
    destinationChoice ??
    (linkedWorkspace != null && linkedWorkspace.id === currentWorkspace?.id ? "current" : "new");

  const destinationWorkspaceId =
    destinationKind === "current"
      ? (currentWorkspace?.id ?? null)
      : destinationKind === "other"
        ? otherWorkspaceId
        : null;

  useEffect(() => {
    if (destinationWorkspaceId == null) {
      setLinkedSources([]);
      return;
    }
    let cancelled = false;
    listSources(destinationWorkspaceId)
      .then((sources) => {
        if (!cancelled) setLinkedSources(sources);
      })
      .catch(() => setLinkedSources([]));
    return () => {
      cancelled = true;
    };
  }, [destinationWorkspaceId, listSources]);

  const handleSelectFile = async () => {
    const selected = await platform.dialog.open({ title: "Select File", multiple: false });
    if (selected == null) return;
    selectSource(selected);
  };

  // The selected folder belongs to the workspace being viewed, so it is only offerable when that
  // is also the destination.
  const canTargetSelectedFolder = selectedFolder != null && destinationKind === "current";

  const destination = (): ImportDestination => {
    if (destinationWorkspaceId == null) {
      return { type: "new_workspace" };
    }
    return {
      type: "existing_workspace",
      workspaceId: destinationWorkspaceId,
      folderId: canTargetSelectedFolder && targetSelectedFolder ? selectedFolder.id : undefined,
    };
  };

  const handlePreview = async () => {
    setIsLoading(true);
    try {
      const nextPlan =
        filePath != null
          ? await planFile(filePath, destination())
          : await planUrl(trimmedSource, destination());
      setPlan(nextPlan);
      setItems(nextPlan.items);
    } catch (err) {
      onError(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommit = async () => {
    if (plan == null) return;
    setIsLoading(true);
    try {
      await commit({ ...plan, items });
    } catch (err) {
      onError(err);
    } finally {
      setIsLoading(false);
    }
  };

  const itemTree = useMemo(() => buildItemTree(items), [items]);

  // A folder row's checkbox aggregates its subtree the way the git commit tree does: creates and
  // updates toggle together, while removals only ever cascade beneath a removed folder.
  const toggleNode = (node: CheckboxTreeNode<ImportPlanItem>, checked: boolean) => {
    const targets = new Set(
      collectItems(node)
        .filter((i) => togglesWith(node.data, i))
        .map((i) => i.modelId),
    );
    setItems((prev) => prev.map((i) => (targets.has(i.modelId) ? { ...i, selected: checked } : i)));
  };

  const resolveConflict = (modelId: string, resolution: "keep_mine" | "take_source") => {
    setItems((prev) =>
      prev.map((item) => (item.modelId === modelId ? { ...item, resolution } : item)),
    );
  };

  // A row the user can't meaningfully toggle on its own: a planned resource inside a deselected
  // new folder can't exist, and a removed folder takes its contents with it.
  const disabledIds = useMemo(() => {
    const disabled = new Set<string>();
    const byId = new Map(items.map((i) => [i.modelId, i]));
    for (const item of items) {
      const seen = new Set<string>();
      let parentId = item.parentId;
      while (parentId != null && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (parent == null || parent.model !== "folder") break;
        if (parent.action === "create" && !parent.selected && item.action !== "delete") {
          disabled.add(item.modelId);
        }
        if (parent.action === "delete" && parent.selected && item.action === "delete") {
          disabled.add(item.modelId);
        }
        parentId = parent.parentId;
      }
    }
    return disabled;
  }, [items]);

  if (plan != null) {
    const unchanged = items.filter((i) => i.action === "unchanged");
    const footerNote =
      unchanged.length > 0
        ? `${unchanged.length} ${pluralize("resource", unchanged.length)} unchanged`
        : "";
    const changeCount = items.filter((item) => {
      if (disabledIds.has(item.modelId)) return false;
      if (item.action === "conflict") return item.resolution === "take_source";
      if (item.action === "unchanged") return false;
      return item.selected;
    }).length;

    const destinationLabel = (() => {
      if (plan.destination.type === "new_workspace") return "New workspace";
      const { workspaceId, folderId } = plan.destination;
      const name = workspaces.find((w) => w.id === workspaceId)?.name ?? "Unknown workspace";
      return folderId != null && folderId === selectedFolder?.id
        ? `${name} / ${selectedFolder.name}`
        : name;
    })();

    // The destination workspace roots the tree. It is not a plan item — commit always applies
    // it — so its checkbox only aggregates the subtree.
    const workspaceRoot: CheckboxTreeNode<ImportPlanItem> = (() => {
      const planned = plan.resources.workspaces[0];
      const planDestination = plan.destination;
      const existing =
        planDestination.type === "existing_workspace"
          ? workspaces.find((w) => w.id === planDestination.workspaceId)
          : null;
      return {
        key: existing?.id ?? planned?.id ?? "workspace",
        data: {
          action: plan.destination.type === "new_workspace" ? "create" : "unchanged",
          model: "workspace",
          modelId: existing?.id ?? planned?.id ?? "workspace",
          name: existing?.name ?? planned?.name ?? "New workspace",
          selected: true,
        },
        children: itemTree,
      };
    })();

    return (
      <VStack space={4} className="pb-4">
        <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
          <PreviewRow label="Detected format" value={plan.importer} />
          <PreviewRow label="Destination" value={destinationLabel} />
        </div>

        <div className="rounded-lg border border-border-subtle px-3 py-2 overflow-y-auto max-h-[40vh]">
          <CheckboxTree
            node={workspaceRoot}
            checked={nodeCheckedStatus}
            onCheck={toggleNode}
            isCheckboxDisabled={(n) => disabledIds.has(n.key)}
            isRelevant={(n) => n.data.model === "workspace" || n.data.action !== "unchanged"}
            renderRow={(n) => <ImportTreeRow item={n.data} onResolveConflict={resolveConflict} />}
          />
        </div>

        {plan.warnings.length > 0 && (
          <div>
            <div className="text-sm font-semibold mb-1">Import details</div>
            <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
              {plan.warnings.map((warning) => (
                <div
                  key={`${warning.title}:${warning.detail}`}
                  className="flex items-start gap-2.5 px-3 py-2.5"
                >
                  <Icon icon="info" color="info" size="sm" className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{warning.title}</div>
                    <div className="text-xs text-text-subtle mt-0.5">{warning.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <HStack space={2} alignItems="center" className="mt-3">
          {footerNote !== "" && <div className="text-xs text-text-subtle">{footerNote}</div>}
          <Button
            className="ml-auto"
            color="secondary"
            variant="border"
            disabled={isLoading}
            onClick={() => {
              setPlan(null);
              setItems([]);
            }}
          >
            Back
          </Button>
          <Button color="primary" isLoading={isLoading} onClick={handleCommit}>
            {isLoading
              ? "Importing"
              : changeCount > 0
                ? `Apply ${changeCount} ${changeCount === 1 ? "Change" : "Changes"}`
                : "Apply"}
          </Button>
        </HStack>
      </VStack>
    );
  }

  const lastImported =
    originSources.find((s) => s.workspaceId === destinationWorkspaceId) ??
    linkedSources.reduce<ImportSource | null>(
      (latest, s) => (latest == null || s.lastImportedAt > latest.lastImportedAt ? s : latest),
      null,
    );

  return (
    <VStack ref={ref} space={4} className="pb-4">
      <CommercialUseBanner source="data-import" title="Importing work data?" />

      <button
        type="button"
        onClick={handleSelectFile}
        className={classNames(
          "w-full rounded-lg border border-dashed px-4 py-6",
          "flex flex-col items-center gap-1 text-center",
          isHovering
            ? "border-notice bg-surface-highlight"
            : "border-border hover:border-text-subtle",
        )}
      >
        <Icon icon="folder_input" className="text-text-subtlest w-8! h-8! mb-2" />
        {/* Fixed height so the region doesn't resize between the empty and selected states */}
        <div className="h-6 w-full flex items-center justify-center">
          {filePath == null ? (
            <div className="text-text">
              <strong className="font-semibold">Choose a file</strong> or drag it here
            </div>
          ) : (
            <div className="text-text font-mono text-xs max-w-full truncate" title={filePath}>
              {fileName(filePath)}
            </div>
          )}
        </div>
        <div className="text-xs text-text-subtlest">
          Supports OpenAPI, Swagger, Postman, Insomnia, and curl
        </div>
      </button>

      <PlainInput
        label="Or enter a file path or URL"
        size="sm"
        placeholder="https://example.com/openapi.json"
        defaultValue={source ?? ""}
        forceUpdateKey={String(forceUpdateKey)}
        onChange={setSource}
      />

      <VStack space={2}>
        <Select
          name="import-destination-kind"
          label="Import location"
          size="sm"
          value={destinationKind}
          onChange={setDestinationChoice}
          options={[
            { value: "new", label: "New Workspace" },
            ...(currentWorkspace != null
              ? [{ value: "current" as const, label: "Current Workspace" }]
              : []),
            { value: "other", label: "Other Workspace" },
          ]}
        />
        {destinationKind === "other" && (
          <Select
            name="import-destination-workspace"
            label="Workspace"
            hideLabel
            size="sm"
            value={otherWorkspaceId ?? ""}
            onChange={(id) => setOtherWorkspaceId(id === "" ? null : id)}
            filterable
            options={[
              { value: "", label: "Select a workspace" },
              ...workspaces
                .filter((w) => w.id !== currentWorkspace?.id)
                .map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
        )}
        {lastImported != null && destinationWorkspaceId != null ? (
          <div className="text-xs text-text-subtle">
            Last imported from {lastImported.originLabel} ·{" "}
            {formatDistanceToNowStrict(`${lastImported.lastImportedAt}Z`, { addSuffix: true })}
          </div>
        ) : linkedWorkspace != null && linkedWorkspace.id !== destinationWorkspaceId ? (
          <div className="text-xs text-text-subtle">
            This file was last imported into{" "}
            <button
              type="button"
              className="underline hocus:text-text"
              onClick={() => {
                if (linkedWorkspace.id === currentWorkspace?.id) {
                  setDestinationChoice("current");
                } else {
                  setDestinationChoice("other");
                  setOtherWorkspaceId(linkedWorkspace.id);
                }
              }}
            >
              {linkedWorkspace.name}
            </button>
          </div>
        ) : null}
        {canTargetSelectedFolder && (
          <Checkbox
            checked={targetSelectedFolder}
            title={`Place root resources in selected folder “${selectedFolder.name}”`}
            onChange={setTargetSelectedFolder}
          />
        )}
      </VStack>

      <HStack space={2} justifyContent="end">
        <Button color="secondary" variant="border" disabled={isLoading} onClick={cancel}>
          Cancel
        </Button>
        <Button
          color="primary"
          disabled={
            trimmedSource === "" ||
            isLoading ||
            (destinationKind === "other" && otherWorkspaceId == null)
          }
          isLoading={isLoading}
          onClick={handlePreview}
        >
          {isLoading ? "Analyzing" : "Preview Import"}
        </Button>
      </HStack>
    </VStack>
  );
}

function ImportTreeRow({
  item,
  onResolveConflict,
}: {
  item: ImportPlanItem;
  onResolveConflict: (modelId: string, resolution: "keep_mine" | "take_source") => void;
}) {
  return (
    <>
      {item.model === "workspace" || item.model === "folder" || item.model === "environment" ? (
        <Icon
          color="secondary"
          icon={
            item.model === "workspace" ? "house" : item.model === "folder" ? "folder" : "variable"
          }
        />
      ) : (
        <span aria-hidden className="w-4" />
      )}
      <div className="truncate flex-1">{item.name}</div>
      {item.action === "conflict" ? (
        <div className="shrink-0 flex items-center gap-1.5">
          <SegmentedControl
            name={`conflict-${item.modelId}`}
            label={`Resolve conflict for ${item.name}`}
            hideLabel
            value={item.resolution ?? "keep_mine"}
            onChange={(v) => onResolveConflict(item.modelId, v)}
            options={[
              { value: "keep_mine", label: "Keep mine" },
              { value: "take_source", label: "Take source" },
            ]}
          />
          <IconTooltip content={actionHelp(item)} iconSize="sm" />
        </div>
      ) : (
        actionLabel(item) && (
          <InlineCode
            className={classNames(
              "py-0 bg-transparent w-32 shrink-0 whitespace-nowrap text-xs",
              "inline-flex items-center justify-center gap-1.5",
              item.action === "create" && "text-success",
              item.action === "update" && "text-info",
              item.action === "delete" && "text-danger",
              item.action === "keep_local" && item.selected && "text-warning",
            )}
          >
            {actionLabel(item)}
            <IconTooltip content={actionHelp(item)} iconSize="xs" />
          </InlineCode>
        )
      )}
    </>
  );
}

function actionLabel(item: ImportPlanItem): string | null {
  switch (item.action) {
    case "create":
      return "new";
    case "update":
      return "updated";
    case "delete":
      return "removed";
    case "keep_local":
      return "edited";
    default:
      return null;
  }
}

function actionHelp(item: ImportPlanItem): string | null {
  switch (item.action) {
    case "create":
      return "Added since the last import";
    case "update":
      return "Changed since the last import";
    case "delete":
      return "Deleted since the last import";
    case "keep_local":
      return "Local edits made since the last import. Importing will revert them if checked";
    case "conflict":
      return "Changed both here and in the file since the last import";
    default:
      return null;
  }
}

function buildItemTree(items: ImportPlanItem[]): CheckboxTreeNode<ImportPlanItem>[] {
  const byId = new Map(items.map((i) => [i.modelId, i]));
  const childrenOf = new Map<string, ImportPlanItem[]>();
  const roots: ImportPlanItem[] = [];
  for (const item of items) {
    if (item.parentId != null && byId.has(item.parentId)) {
      const siblings = childrenOf.get(item.parentId) ?? [];
      siblings.push(item);
      childrenOf.set(item.parentId, siblings);
    } else {
      roots.push(item);
    }
  }

  const foldersFirst = (list: ImportPlanItem[]) => [
    ...list.filter((i) => i.model === "folder"),
    ...list.filter((i) => i.model !== "folder"),
  ];

  const toNode = (item: ImportPlanItem, seen: Set<string>): CheckboxTreeNode<ImportPlanItem> => ({
    key: item.modelId,
    data: item,
    children: seen.has(item.modelId)
      ? []
      : foldersFirst(childrenOf.get(item.modelId) ?? []).map((c) =>
          toNode(c, new Set([...seen, item.modelId])),
        ),
  });

  return foldersFirst(roots).map((r) => toNode(r, new Set()));
}

function collectItems(node: CheckboxTreeNode<ImportPlanItem>): ImportPlanItem[] {
  return [node.data, ...node.children.flatMap(collectItems)];
}

/**
 * Whether toggling `root`'s checkbox also toggles `item` in its subtree. Destructive decisions
 * (deletions, reverting local edits) never ride along with a parent toggle.
 */
function togglesWith(root: ImportPlanItem, item: ImportPlanItem): boolean {
  if (item.model === "workspace") return false;
  if (root.action === "delete") return item.action === "delete";
  if (item.action === "keep_local") {
    return root.modelId === item.modelId && item.model !== "folder";
  }
  return item.action === "create" || item.action === "update";
}

function nodeCheckedStatus(
  node: CheckboxTreeNode<ImportPlanItem>,
): boolean | "indeterminate" | "hidden" {
  const covered = collectItems(node).filter((i) => togglesWith(node.data, i));
  if (covered.length === 0) return "hidden";
  const selected = covered.filter((i) => i.selected).length;
  if (selected === covered.length) return true;
  if (selected === 0) return false;
  return "indeterminate";
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
      <span className="text-text-subtle">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

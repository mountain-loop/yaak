import {
  type ImportDestination,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSource,
  type Workspace,
} from "@yaakapp-internal/models";
import { Banner, FormattedError, HStack, Icon, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/errorMessage";
import { pluralize } from "../lib/pluralize";
import { CommercialUseBanner } from "./CommercialUseBanner";
import {
  ImportSourceList,
  type ImportSourceDetection,
  type ImportSourcePath,
  InlineButton,
  toSourcePath,
} from "./ImportSourceList";
import type { CheckboxTreeNode } from "./core/CheckboxTree";
import { CheckboxTree } from "./core/CheckboxTree";
import { Chip } from "./core/Chip";
import { DialogFooter } from "./core/Dialog";
import { IconTooltip } from "./core/IconTooltip";
import { Select } from "./core/Select";
import { SegmentedControl } from "./core/SegmentedControl";

interface Props {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  planSources: (sources: ImportSourcePath[], destination: ImportDestination) => Promise<ImportPlan>;
  detectSource: (source: ImportSourcePath) => Promise<string>;
  listSources: (workspaceId: string) => Promise<ImportSource[]>;
  findSourcesForOrigin: (args: { filePath?: string; url?: string }) => Promise<ImportSource[]>;
  commit: (plan: ImportPlan) => Promise<void>;
  cancel: () => void;
  onError: (err: unknown) => void;
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

function LoadedImportDataDialog({
  currentWorkspace,
  workspaces,
  planSources,
  detectSource,
  findSourcesForOrigin,
  commit,
  cancel,
  onError,
  initialSources,
}: Props & { initialSources: ImportSource[] }) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [items, setItems] = useState<ImportPlanItem[]>([]);
  // null means no explicit choice yet, so the default below applies
  const [destinationChoice, setDestinationChoice] = useState<"new" | "current" | "other" | null>(
    null,
  );
  const [otherWorkspaceId, setOtherWorkspaceId] = useState<string | null>(null);
  const [originSources, setOriginSources] = useState<ImportSource[]>(initialSources);
  const initialPaths = useMemo(
    () => [...new Set(initialSources.map((source) => source.origin))].map(toSourcePath),
    [initialSources],
  );
  const [sources, setSources] = useState<ImportSourcePath[]>(initialPaths);
  const knownPaths = useRef(new Set(initialPaths.map((source) => source.path)));
  const [detections, setDetections] = useState<Record<string, ImportSourceDetection>>({});
  const detect = useCallback(
    (added: ImportSourcePath[]) => {
      setDetections((prev) => ({
        ...prev,
        ...Object.fromEntries(added.map((s) => [s.path, { status: "loading" as const }])),
      }));
      for (const source of added) {
        const settle = (detection: ImportSourceDetection) =>
          setDetections((prev) =>
            source.path in prev ? { ...prev, [source.path]: detection } : prev,
          );
        detectSource(source).then(
          (importer) => settle({ status: "ok", importer }),
          (err) => settle({ status: "error", message: errorMessage(err) }),
        );
      }
    },
    [detectSource],
  );
  const allDetected = sources.every((source) => detections[source.path]?.status === "ok");
  useEffect(() => {
    detect(initialPaths);
  }, [detect, initialPaths]);

  const addSources = useCallback(
    (added: ImportSourcePath[]) => {
      setSourceError(null);
      const fresh = added.filter(({ path }) => {
        if (knownPaths.current.has(path)) return false;
        knownPaths.current.add(path);
        return true;
      });
      if (fresh.length === 0) return;
      setSources((existing) => [...existing, ...fresh]);
      detect(fresh);
    },
    [detect],
  );
  const removeSource = (path: string) => {
    setSourceError(null);
    knownPaths.current.delete(path);
    setSources((current) => current.filter((source) => source.path !== path));
    setDetections(({ [path]: _removed, ...rest }) => rest);
  };

  useEffect(() => {
    let cancelled = false;
    if (sources.length === 0) {
      setOriginSources([]);
      return;
    }
    Promise.all(
      sources.map(({ path, kind }) =>
        findSourcesForOrigin(kind === "url" ? { url: path } : { filePath: path }),
      ),
    )
      .then((found) => {
        if (!cancelled) setOriginSources(found.flat());
      })
      .catch(() => {
        if (!cancelled) setOriginSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sources, findSourcesForOrigin]);

  // The one workspace these sources are linked to, if there is exactly one.
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

  const destination = (): ImportDestination => {
    if (destinationWorkspaceId == null) {
      return { type: "new_workspace" };
    }
    return {
      type: "existing_workspace",
      workspaceId: destinationWorkspaceId,
    };
  };

  const handlePreview = async () => {
    setIsLoading(true);
    setSourceError(null);
    try {
      const nextPlan = await planSources(sources, destination());
      setPlan(nextPlan);
      setItems(nextPlan.items);
    } catch (err) {
      setSourceError(err);
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

  // A folder row's checkbox carries everything beneath it, deletions included — the row labels
  // say which of those are destructive. Checking anything also brings back the folders it needs
  // to live in.
  const toggleNode = (node: CheckboxTreeNode<TreeRow>, checked: boolean) => {
    const targets = new Set(togglableItems(node).map((i) => i.modelId));
    if (checked && node.data.kind === "item") {
      const byId = new Map(items.map((i) => [i.modelId, i]));
      for (const ancestor of ancestorsOf(node.data.item, byId)) {
        if (isMissingFolder(ancestor)) targets.add(ancestor.modelId);
      }
    }
    setItems((prev) => prev.map((i) => (targets.has(i.modelId) ? { ...i, selected: checked } : i)));
  };

  const resolveConflict = (modelId: string, resolution: "keep_mine" | "take_source") => {
    setItems((prev) =>
      prev.map((item) => (item.modelId === modelId ? { ...item, resolution } : item)),
    );
  };

  // Deleting a folder takes its contents with it, so those rows have nothing left to decide.
  const disabledIds = useMemo(() => {
    const disabled = new Set<string>();
    const byId = new Map(items.map((i) => [i.modelId, i]));
    for (const item of items) {
      if (item.action !== "delete") continue;
      for (const parent of ancestorsOf(item, byId)) {
        if (parent.action === "delete" && parent.selected) {
          disabled.add(item.modelId);
        }
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

    // The row's label carries what kind of destination it is, so the value can just be its name
    const [destinationLabel, destinationValue] = ((): [string, string] => {
      if (plan.destination.type === "new_workspace") {
        const names = plan.resources.workspaces.map((w) => w.name).filter((n) => n !== "");
        if (names.length === 0) return ["New workspace", "Untitled"];
        return [
          names.length === 1 ? "New workspace" : `${names.length} new workspaces`,
          names.join(", "),
        ];
      }
      const { workspaceId } = plan.destination;
      const name = workspaces.find((w) => w.id === workspaceId)?.name ?? "Unknown workspace";
      return ["Destination", name];
    })();

    // The destination workspace roots the tree. It is not a plan item — commit always applies
    // it — so its checkbox only aggregates the subtree.
    const workspaceRoots: CheckboxTreeNode<TreeRow>[] = (() => {
      const planDestination = plan.destination;
      const existing =
        planDestination.type === "existing_workspace"
          ? workspaces.find((w) => w.id === planDestination.workspaceId)
          : null;
      const destinations = existing ? [existing] : plan.resources.workspaces;
      if (destinations.length === 1) {
        const workspace = destinations[0]!;
        return [
          {
            key: workspace.id,
            data: {
              kind: "destination",
              label: workspace.name,
              isNew: planDestination.type === "new_workspace",
            },
            children: buildItemTree(items),
          },
        ];
      }
      const workspaceById = new Map(
        [
          ...plan.resources.environments,
          ...plan.resources.folders,
          ...plan.resources.httpRequests,
          ...plan.resources.grpcRequests,
          ...plan.resources.websocketRequests,
        ].map((resource) => [resource.id, resource.workspaceId]),
      );
      return destinations.map((workspace) => ({
        key: workspace.id,
        data: {
          kind: "destination",
          label: workspace.name,
          isNew: planDestination.type === "new_workspace",
        },
        children: buildItemTree(
          items.filter((item) => workspaceById.get(item.modelId) === workspace.id),
        ),
      }));
    })();

    return (
      <>
        <VStack space={4} className="pb-4">
          <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
            <PreviewRow label="Detected format" value={plan.importer} />
            <PreviewRow label={destinationLabel} value={destinationValue} />
          </div>

          {plan.warnings
            .filter(
              (warning, index, warnings) =>
                warnings.findIndex(
                  (other) =>
                    other.title === warning.title &&
                    other.detail === warning.detail &&
                    other.level === warning.level,
                ) === index,
            )
            .map((warning) => (
              <Banner
                key={`${warning.level}:${warning.title}:${warning.detail}`}
                color={warning.level === "warning" ? "warning" : "info"}
                className="flex items-start gap-2.5"
              >
                <Icon
                  icon={warning.level === "warning" ? "alert_triangle" : "info"}
                  size="sm"
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{warning.title}</div>
                  <div className="text-xs text-text-subtle mt-0.5">{warning.detail}</div>
                </div>
              </Banner>
            ))}

          {workspaceRoots.map((root) => (
            <div key={root.key} className="rounded-lg border border-border-subtle px-3 py-2">
              <CheckboxTree
                node={root}
                checked={nodeCheckedStatus}
                onCheck={toggleNode}
                isCheckboxDisabled={(n) => disabledIds.has(n.key)}
                isCollapsedByDefault={(n) =>
                  (n.data.kind === "destination" && workspaceRoots.length > 1) ||
                  (n.data.kind === "item" && n.data.item.action === "ignored")
                }
                isRelevant={(n) =>
                  n.data.kind === "destination" ||
                  (n.data.kind === "item" && n.data.item.action !== "unchanged")
                }
                renderRow={(n) => (
                  <ImportTreeRow row={n.data} onResolveConflict={resolveConflict} />
                )}
              />
            </div>
          ))}
        </VStack>
        <DialogFooter
          leftSlot={
            footerNote !== "" ? (
              <div className="text-xs text-text-subtle">{footerNote}</div>
            ) : undefined
          }
          actions={[
            {
              label: "Back",
              disabled: isLoading,
              onClick: () => {
                setPlan(null);
                setItems([]);
              },
            },
            {
              label: isLoading
                ? "Importing"
                : changeCount > 0
                  ? `Apply ${changeCount} ${changeCount === 1 ? "Change" : "Changes"}`
                  : "Done",
              color: "primary",
              isLoading,
              onClick: handleCommit,
            },
          ]}
        />
      </>
    );
  }

  const destinationPicker = (
    <HStack
      space={2}
      alignItems="center"
      className={classNames(workspaces.length === 0 && "hidden")}
    >
      <Select
        name="import-destination-kind"
        label="Import into"
        labelPosition="left"
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
    </HStack>
  );

  return (
    <>
      <VStack space={4} className="h-full pb-4">
        <CommercialUseBanner source="data-import" title="Importing work data?" />

        <ImportSourceList
          sources={sources}
          detections={detections}
          disabled={isLoading}
          onAdd={addSources}
          onRemove={removeSource}
          onError={setSourceError}
        />

        {sourceError != null && (
          <Banner color="warning">
            <FormattedError>{errorMessage(sourceError)}</FormattedError>
          </Banner>
        )}

        {linkedWorkspace != null && linkedWorkspace.id !== destinationWorkspaceId && (
          <div className="text-xs text-text-subtle">
            {sources.length === 1 ? "This source was" : "These sources were"} last imported into{" "}
            <InlineButton
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
            </InlineButton>
          </div>
        )}
      </VStack>
      <DialogFooter
        leftSlot={destinationPicker}
        actions={[
          { label: "Cancel", disabled: isLoading, onClick: cancel },
          {
            label: isLoading ? "Analyzing" : "Preview Import",
            color: "primary",
            disabled:
              sources.length === 0 ||
              !allDetected ||
              isLoading ||
              (destinationKind === "other" && otherWorkspaceId == null),
            isLoading,
            onClick: handlePreview,
          },
        ]}
      />
    </>
  );
}

function ImportTreeRow({
  row,
  onResolveConflict,
}: {
  row: TreeRow;
  onResolveConflict: (modelId: string, resolution: "keep_mine" | "take_source") => void;
}) {
  if (row.kind !== "item") {
    return (
      <>
        {row.kind === "destination" && (
          <Icon icon="box" size="sm" className="shrink-0 text-text-subtle" />
        )}
        <div className="truncate flex-1">{row.label}</div>
        {row.kind === "destination" && row.isNew && (
          <ActionChip label="new" help="Created by this import" color="success" />
        )}
      </>
    );
  }

  const { item } = row;
  const label = actionLabel(item);
  return (
    <>
      <div className="truncate flex-1">{item.name}</div>
      {item.action === "conflict" ? (
        <div className="shrink-0">
          <SegmentedControl
            name={`conflict-${item.modelId}`}
            label={`Resolve conflict for ${item.name}`}
            hideLabel
            size="2xs"
            help={actionHelp(item)}
            value={item.resolution ?? "keep_mine"}
            onChange={(v) => onResolveConflict(item.modelId, v)}
            options={[
              { value: "keep_mine", label: "Keep mine" },
              { value: "take_source", label: "Take source" },
            ]}
          />
        </div>
      ) : (
        label != null && (
          <ActionChip label={label} help={actionHelp(item)} color={actionColor(item)} />
        )
      )}
    </>
  );
}

function ActionChip({
  label,
  help,
  color,
}: {
  label: string;
  help: string | null;
  color: ComponentProps<typeof Chip>["color"];
}) {
  return (
    <Chip color={color}>
      {label}
      {help != null && <IconTooltip content={help} iconSize="xs" />}
    </Chip>
  );
}

function actionColor(item: ImportPlanItem): ComponentProps<typeof Chip>["color"] {
  switch (item.action) {
    case "create":
      return "success";
    case "update":
      return "info";
    case "delete":
      return "danger";
    case "keep_local":
      return item.selected ? "warning" : "default";
    case "unchanged":
    case "conflict":
    case "ignored":
      return "default";
  }
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
    case "ignored":
      return "ignored";
    default:
      return null;
  }
}

function actionHelp(item: ImportPlanItem): string | null {
  const help = (text: string) =>
    item.changedFields.length > 0
      ? `${text} · ${item.changedFields.map(fieldLabel).join(", ")}`
      : text;
  switch (item.action) {
    case "create":
      return "Not in this workspace yet";
    case "update":
      return item.reason === "moved_into_ignored_folder"
        ? "Moved into a folder that isn't imported. Importing that folder brings it along"
        : help("Changed in the source since the last import");
    case "delete":
      return "Gone from the source since the last import. Checking it deletes it here";
    case "keep_local":
      return help("Changed here since the last import. Checking it reverts to the source");
    case "conflict":
      return help("Changed here and in the source since the last import");
    case "ignored":
      return "Not in this workspace. Imports leave it alone until you check it";
    default:
      return null;
  }
}

function fieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** Every plan item above `item`, nearest first. */
function ancestorsOf(item: ImportPlanItem, byId: Map<string, ImportPlanItem>): ImportPlanItem[] {
  const ancestors: ImportPlanItem[] = [];
  const seen = new Set<string>();
  let parentId = item.parentId;
  while (parentId != null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent == null) break;
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

/**
 * A row of the preview tree. Most are plan items, but the destination workspace and the group the
 * workspace's environments sit in are headings: they aggregate their children and decide nothing
 * themselves.
 */
type TreeRow =
  | { kind: "destination"; label: string; isNew: boolean }
  | { kind: "group"; label: string }
  | { kind: "item"; item: ImportPlanItem };

function buildItemTree(items: ImportPlanItem[]): CheckboxTreeNode<TreeRow>[] {
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

  const byKind = (list: ImportPlanItem[]) => [
    ...list.filter((i) => i.model === "environment"),
    ...list.filter((i) => i.model === "folder"),
    ...list.filter((i) => i.model !== "environment" && i.model !== "folder"),
  ];

  const toNode = (item: ImportPlanItem, seen: Set<string>): CheckboxTreeNode<TreeRow> => ({
    key: item.modelId,
    data: { kind: "item", item },
    children: seen.has(item.modelId)
      ? []
      : byKind(childrenOf.get(item.modelId) ?? []).map((c) =>
          toNode(c, new Set([...seen, item.modelId])),
        ),
  });

  // The workspace's environments have nothing to sit under — a sub-environment is a sibling of
  // the base one, not its child — so a heading groups them into one thing to turn on and off.
  const environments = roots.filter((i) => i.model === "environment");
  const others = byKind(roots.filter((i) => i.model !== "environment"));
  const nodes = others.map((r) => toNode(r, new Set()));
  if (environments.length === 0) return nodes;
  return [
    {
      key: "group:environments",
      data: { kind: "group", label: "Variables" },
      children: environments.map((e) => toNode(e, new Set())),
    },
    ...nodes,
  ];
}

function collectRows(node: CheckboxTreeNode<TreeRow>): TreeRow[] {
  return [node.data, ...node.children.flatMap(collectRows)];
}

/** A folder that isn't there yet, so anything inside it needs it brought in first. */
function isMissingFolder(item: ImportPlanItem): boolean {
  return item.model === "folder" && (item.action === "create" || item.action === "ignored");
}

/**
 * The plan item a row's checkbox decides, if it decides one. An unchanged resource has nothing to
 * decide and a conflict is decided by its own control, so neither takes a checkbox — nor rides
 * along with a parent's.
 */
function togglableItem(row: TreeRow): ImportPlanItem | null {
  if (row.kind !== "item") return null;
  const { item } = row;
  return item.action === "unchanged" || item.action === "conflict" ? null : item;
}

function togglableItems(node: CheckboxTreeNode<TreeRow>): ImportPlanItem[] {
  return collectRows(node)
    .map(togglableItem)
    .filter((i) => i != null);
}

function nodeCheckedStatus(node: CheckboxTreeNode<TreeRow>): boolean | "indeterminate" | "hidden" {
  const covered = togglableItems(node);
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

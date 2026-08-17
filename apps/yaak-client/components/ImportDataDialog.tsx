import {
  type Folder,
  type ImportDestination,
  type ImportPlan,
  modelTypeLabel,
  type Workspace,
} from "@yaakapp-internal/models";
import { HStack, Icon, VStack } from "@yaakapp-internal/ui";
import { platform } from "@yaakapp-internal/platform";
import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "react-use";
import { pluralizeCount } from "../lib/pluralize";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { PlainInput } from "./core/PlainInput";
import { RadioCards } from "./core/RadioCards";

interface Props {
  currentWorkspace: Workspace | null;
  selectedFolder: Folder | null;
  planFile: (filePath: string, destination: ImportDestination) => Promise<ImportPlan>;
  planUrl: (url: string, destination: ImportDestination) => Promise<ImportPlan>;
  commit: (plan: ImportPlan) => Promise<void>;
  cancel: () => void;
  onError: (err: unknown) => void;
}

type DestinationChoice = "new_workspace" | "current_workspace";

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

export function ImportDataDialog({
  currentWorkspace,
  selectedFolder,
  planFile,
  planUrl,
  commit,
  cancel,
  onError,
}: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [destinationChoice, setDestinationChoice] = useState<DestinationChoice>(
    currentWorkspace == null ? "new_workspace" : "current_workspace",
  );
  const [targetSelectedFolder, setTargetSelectedFolder] = useState(selectedFolder != null);
  // A file path or a URL. Both inputs write here, so there is only ever one thing to import
  const [source, setSource] = useLocalStorage<string | null>("importPathOrUrl", null);
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

  const handleSelectFile = async () => {
    const selected = await platform.dialog.open({ title: "Select File", multiple: false });
    if (selected == null) return;
    selectSource(selected);
  };

  const destination = (): ImportDestination => {
    if (destinationChoice === "current_workspace" && currentWorkspace != null) {
      return {
        type: "current_workspace",
        workspaceId: currentWorkspace.id,
        folderId: targetSelectedFolder ? selectedFolder?.id : undefined,
      };
    }
    return { type: "new_workspace" };
  };

  const handlePreview = async () => {
    setIsLoading(true);
    try {
      const nextPlan =
        filePath != null
          ? await planFile(filePath, destination())
          : await planUrl(trimmedSource, destination());
      setPlan(nextPlan);
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
      await commit(plan);
    } catch (err) {
      onError(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (plan != null) {
    const counts = [
      [plan.resources.workspaces[0]?.resource, plan.resources.workspaces.length],
      [plan.resources.environments[0]?.resource, plan.resources.environments.length],
      [plan.resources.folders[0]?.resource, plan.resources.folders.length],
      [plan.resources.httpRequests[0]?.resource, plan.resources.httpRequests.length],
      [plan.resources.grpcRequests[0]?.resource, plan.resources.grpcRequests.length],
      [plan.resources.websocketRequests[0]?.resource, plan.resources.websocketRequests.length],
    ] as const;
    const destinationLabel =
      plan.destination.type === "new_workspace"
        ? "New workspace"
        : selectedFolder != null && plan.destination.folderId === selectedFolder.id
          ? `${currentWorkspace?.name ?? "Current workspace"} / ${selectedFolder.name}`
          : (currentWorkspace?.name ?? "Current workspace");

    return (
      <VStack space={4} className="pb-4">
        <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
          <PreviewRow label="Detected format" value={plan.importer} />
          <PreviewRow label="Destination" value={destinationLabel} />
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">Resources</div>
          <ul className="list-disc pl-6 text-sm text-text-subtle">
            {counts.map(([model, count]) =>
              model == null ? null : (
                <li key={model.model}>{pluralizeCount(modelTypeLabel(model), count)}</li>
              ),
            )}
          </ul>
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

        <HStack space={2} justifyContent="end">
          <Button color="secondary" variant="border" disabled={isLoading} onClick={cancel}>
            Cancel
          </Button>
          <Button color="primary" isLoading={isLoading} onClick={handleCommit}>
            {isLoading ? "Importing" : "Confirm Import"}
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack ref={ref} space={4} className="pb-4">
      <CommercialUseBanner source="data-import" title="Importing work data?" />

      <button
        type="button"
        onClick={handleSelectFile}
        className={classNames(
          "w-full rounded-lg border border-dashed px-4 py-6",
          "flex flex-col items-center gap-1 text-center",
          isHovering ? "border-notice bg-surface-highlight" : "border-border hover:border-text",
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
        <div className="text-sm font-semibold">Import destination</div>
        <RadioCards
          name="import-destination"
          value={destinationChoice}
          onChange={setDestinationChoice}
          options={[
            {
              value: "new_workspace",
              label: "New workspace",
              description: "Create imported resources in a separate workspace.",
            },
            ...(currentWorkspace == null
              ? []
              : [
                  {
                    value: "current_workspace" as const,
                    label: currentWorkspace.name,
                    description: "Add resources without changing this workspace's settings.",
                  },
                ]),
          ]}
        />
        {destinationChoice === "current_workspace" && selectedFolder != null && (
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
          disabled={trimmedSource === "" || isLoading}
          isLoading={isLoading}
          onClick={handlePreview}
        >
          {isLoading ? "Analyzing" : "Preview Import"}
        </Button>
      </HStack>
    </VStack>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
      <span className="text-text-subtle">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

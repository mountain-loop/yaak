import { platform } from "@yaakapp-internal/platform";
import { Icon, LoadingIcon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./core/Button";
import { IconButton } from "./core/IconButton";
import { PathList, splitPath } from "./core/PathList";
import { PlainInput } from "./core/PlainInput";

export interface ImportSourcePath {
  path: string;
  kind?: "file" | "folder" | "url";
}

export type ImportSourceDetection =
  | { status: "loading" }
  | { status: "ok"; importer: string }
  | { status: "error"; message: string };

interface Props {
  sources: ImportSourcePath[];
  detections: Record<string, ImportSourceDetection>;
  disabled?: boolean;
  onAdd: (sources: ImportSourcePath[]) => void;
  onRemove: (path: string) => void;
  onError: (err: unknown) => void;
}

/** A bare hostname is a URL; local paths need an absolute or explicit relative prefix. */
export function isImportFilePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

export function ImportSourceList({
  sources,
  detections,
  disabled,
  onAdd,
  onRemove,
  onError,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [pathInputKey, setPathInputKey] = useState(0);
  const [showPathInput, setShowPathInput] = useState(false);
  const trimmedPath = pathInput.trim();

  const closePathInput = () => {
    setPathInput("");
    setPathInputKey((k) => k + 1);
    setShowPathInput(false);
  };

  const addPath = () => {
    if (!trimmedPath || disabled) return;
    onAdd([{ path: trimmedPath, kind: isImportFilePath(trimmedPath) ? undefined : "url" }]);
    closePathInput();
  };

  useEffect(() => {
    if (disabled) return;
    return platform.window.onDragDrop((event) => {
      if (event.type === "leave") {
        setIsHovering(false);
        return;
      }
      const rect = ref.current?.getBoundingClientRect();
      const { x, y } = event.position;
      const isOver =
        rect != null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (event.type === "drop") {
        if (isOver) onAdd(event.paths.map((path) => ({ path })));
        setIsHovering(false);
      } else {
        setIsHovering(isOver);
      }
    });
  }, [disabled, onAdd]);

  const pick = async (directory: boolean) => {
    try {
      const selected = await platform.dialog.open({
        title: directory ? "Select Import Folder" : "Select Import Files",
        multiple: true,
        directory,
      });
      if (selected == null) return;
      onAdd(selected.map((path) => ({ path, kind: directory ? "folder" : "file" })));
    } catch (err) {
      onError(err);
    }
  };

  const handlePathKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addPath();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      closePathInput();
    }
  };

  const pathInputEl = (
    <PlainInput
      label="URL or file path"
      hideLabel
      size="sm"
      autoFocus
      disabled={disabled}
      placeholder="Paste a URL or a file path"
      forceUpdateKey={String(pathInputKey)}
      onChange={setPathInput}
      onKeyDownCapture={handlePathKeyDown}
      rightSlot={
        <div className="flex items-center gap-1 my-1 mr-1">
          {trimmedPath !== "" && (
            <Button size="xs" variant="border" onClick={addPath}>
              Add
            </Button>
          )}
          <IconButton size="xs" icon="x" title="Cancel" onClick={closePathInput} />
        </div>
      }
    />
  );

  if (sources.length === 0) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        <div
          ref={ref}
          className={classNames(
            "flex-1 rounded-lg border min-h-28 flex flex-col items-center justify-center gap-2 px-4 py-5 text-center text-text-subtle",
            isHovering ? "border-notice bg-surface-highlight" : "border-dashed border-border",
          )}
        >
          <Icon icon="folder_input" className="text-text-subtlest w-8! h-8!" />
          {isHovering ? (
            <span>Drop to add</span>
          ) : (
            <span>
              Choose{" "}
              <InlineButton disabled={disabled} onClick={() => pick(false)}>
                files
              </InlineButton>
              , a{" "}
              <InlineButton disabled={disabled} onClick={() => pick(true)}>
                folder
              </InlineButton>
              , or a{" "}
              <InlineButton
                disabled={disabled || showPathInput}
                onClick={() => setShowPathInput(true)}
              >
                URL
              </InlineButton>
              , or drag them here
            </span>
          )}
          <span className="text-xs text-text-subtlest">
            Supports OpenAPI, Swagger, Postman, Insomnia, Bruno, curl, and Yaak exports
          </span>
        </div>
        {showPathInput && pathInputEl}
      </div>
    );
  }

  return (
    <PathList
      ref={ref}
      hovering={isHovering}
      disabled={disabled}
      onRemove={onRemove}
      addLabel="Add files, a folder, or a URL"
      addHint="or drop them here"
      addItems={[
        { label: "Files", icon: "file", onSelect: () => pick(false) },
        { label: "Folder", icon: "folder", onSelect: () => pick(true) },
        {
          label: "URL or file path",
          icon: "globe",
          disabled: showPathInput,
          onSelect: () => setShowPathInput(true),
        },
      ]}
      items={sources.map((source) => {
        const detection = detections[source.path];
        return {
          path: source.path,
          icon: sourceIcon(source),
          failed: detection?.status === "error",
          subtitle: <DetectionSubtitle path={source.path} detection={detection} />,
        };
      })}
    >
      {showPathInput && pathInputEl}
    </PathList>
  );
}

function DetectionSubtitle({
  path,
  detection,
}: {
  path: string;
  detection: ImportSourceDetection | undefined;
}) {
  const { parent } = splitPath(path);
  if (detection?.status === "loading") {
    return (
      <>
        <LoadingIcon size="xs" />
        Detecting format
      </>
    );
  }
  if (detection?.status === "error") return detection.message;
  return (
    <>
      {detection?.status === "ok" && <span>{detection.importer}</span>}
      {detection?.status === "ok" && parent !== "" && <span>·</span>}
      {parent !== "" && <span className="truncate font-mono">{parent}</span>}
    </>
  );
}

function sourceIcon({ kind }: ImportSourcePath) {
  switch (kind) {
    case "url":
      return "globe";
    case "folder":
      return "folder";
    case "file":
      return "file";
    case undefined:
      return "import";
  }
}

function InlineButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="text-text underline underline-offset-2 hocus:text-primary disabled:opacity-disabled"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

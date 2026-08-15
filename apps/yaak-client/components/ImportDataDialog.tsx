import { platform } from "@yaakapp-internal/platform";
import { Icon, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "react-use";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { Button } from "./core/Button";
import { PlainInput } from "./core/PlainInput";

interface Props {
  importFile: (filePath: string) => Promise<void>;
  importUrl: (url: string) => Promise<void>;
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

export function ImportDataDialog({ importFile, importUrl }: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // A file path or a URL. Both inputs write here, so there is only ever one thing to import
  const [source, setSource] = useLocalStorage<string | null>("importPathOrUrl", null);
  const [forceUpdateKey, setForceUpdateKey] = useState<number>(0);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);
  const trimmedSource = source?.trim() ?? "";
  const filePath = isFilePath(trimmedSource) ? trimmedSource : null;

  const selectSource = (value: string) => {
    setSource(value);
    // Remount the URL input so it reflects the newly-picked file
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

  const handleImport = async () => {
    setIsLoading(true);
    try {
      if (filePath != null) {
        await importFile(filePath);
      } else {
        await importUrl(trimmedSource);
      }
    } finally {
      setIsLoading(false);
    }
  };

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
        {filePath == null ? (
          <div className="text-text">
            <strong className="font-semibold">Choose a file</strong> or drag it here
          </div>
        ) : (
          <div className="text-text font-mono text-xs w-full truncate" title={filePath}>
            {fileName(filePath)}
          </div>
        )}
        <div className="text-xs text-text-subtlest">
          Supports OpenAPI, Swagger, Postman, Insomnia, and curl
        </div>
      </button>

      <VStack space={2}>
        <PlainInput
          label="Or enter a URL"
          size="sm"
          placeholder="https://example.com/openapi.json"
          defaultValue={filePath == null ? (source ?? "") : ""}
          forceUpdateKey={String(forceUpdateKey)}
          onChange={setSource}
        />
        <Button
          color="primary"
          disabled={trimmedSource === "" || isLoading}
          isLoading={isLoading}
          size="sm"
          onClick={handleImport}
        >
          {isLoading ? "Importing" : "Import"}
        </Button>
      </VStack>
    </VStack>
  );
}

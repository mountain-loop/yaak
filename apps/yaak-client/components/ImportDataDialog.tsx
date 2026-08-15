import { VStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import { useLocalStorage } from "react-use";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { Button } from "./core/Button";
import { PlainInput } from "./core/PlainInput";
import { SegmentedControl } from "./core/SegmentedControl";
import { SelectFile } from "./SelectFile";

type ImportSource = "file" | "url";

interface Props {
  importFile: (filePath: string) => Promise<void>;
  importUrl: (url: string) => Promise<void>;
}

export function ImportDataDialog({ importFile, importUrl }: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [source, setSource] = useLocalStorage<ImportSource>("importSource", "file");
  const [filePath, setFilePath] = useLocalStorage<string | null>("importFilePath", null);
  const [url, setUrl] = useLocalStorage<string | null>("importUrl", null);
  const activeSource = source ?? "file";
  const trimmedUrl = url?.trim() ?? "";

  const runImport = async (importFn: () => Promise<void>) => {
    setIsLoading(true);
    try {
      await importFn();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <VStack space={5} className="pb-4">
      <CommercialUseBanner source="data-import" title="Importing work data?" />

      <VStack space={1}>
        <ul className="list-disc pl-5">
          <li>OpenAPI 3.0, 3.1</li>
          <li>Postman Collection v2, v2.1</li>
          <li>Insomnia v4+</li>
          <li>Swagger 2.0</li>
          <li>
            Curl commands <em className="text-text-subtle">(or paste into URL)</em>
          </li>
        </ul>
      </VStack>
      <VStack space={2}>
        <SegmentedControl
          name="importSource"
          label="Import From"
          hideLabel
          value={activeSource}
          onChange={setSource}
          options={[
            { value: "file", label: "File" },
            { value: "url", label: "URL" },
          ]}
        />

        {activeSource === "file" ? (
          <>
            <SelectFile
              filePath={filePath ?? null}
              onChange={({ filePath }) => setFilePath(filePath)}
            />
            {filePath && (
              <Button
                color="primary"
                disabled={isLoading}
                isLoading={isLoading}
                size="sm"
                onClick={() => runImport(() => importFile(filePath))}
              >
                {isLoading ? "Importing" : "Import"}
              </Button>
            )}
          </>
        ) : (
          <>
            <PlainInput
              label="URL"
              hideLabel
              placeholder="https://example.com/openapi.json"
              defaultValue={url ?? ""}
              onChange={setUrl}
            />
            <Button
              color="primary"
              disabled={trimmedUrl === "" || isLoading}
              isLoading={isLoading}
              size="sm"
              onClick={() => runImport(() => importUrl(trimmedUrl))}
            >
              {isLoading ? "Importing" : "Import"}
            </Button>
          </>
        )}
      </VStack>
    </VStack>
  );
}

import { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { Button } from './core/Button';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

type ImportSource = 'file' | 'url';

interface Props {
  importFile: (filePath: string) => Promise<void>;
  importOpenApiUrl: (url: string) => Promise<void>;
}

export function ImportDataDialog({ importFile, importOpenApiUrl }: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [source, setSource] = useLocalStorage<ImportSource>('importSource', 'file');
  const [filePath, setFilePath] = useLocalStorage<string | null>('importFilePath', null);
  const [url, setUrl] = useLocalStorage<string | null>('importOpenApiUrl', null);
  const activeSource = source ?? 'file';
  const trimmedUrl = url?.trim() ?? '';

  return (
    <VStack space={5} className="pb-4">
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
        <HStack space={2}>
          <Button
            size="xs"
            variant={activeSource === 'file' ? 'solid' : 'border'}
            color={activeSource === 'file' ? 'primary' : 'default'}
            onClick={() => setSource('file')}
          >
            File
          </Button>
          <Button
            size="xs"
            variant={activeSource === 'url' ? 'solid' : 'border'}
            color={activeSource === 'url' ? 'primary' : 'default'}
            onClick={() => setSource('url')}
          >
            OpenAPI URL
          </Button>
        </HStack>

        {activeSource === 'file' ? (
          <>
            <SelectFile
              filePath={filePath ?? null}
              onChange={({ filePath }) => setFilePath(filePath)}
            />
            {filePath && (
              <Button
                color="primary"
                disabled={!filePath || isLoading}
                isLoading={isLoading}
                size="sm"
                onClick={async () => {
                  setIsLoading(true);
                  try {
                    await importFile(filePath);
                  } finally {
                    setIsLoading(false);
                  }
                }}
              >
                {isLoading ? 'Importing' : 'Import'}
              </Button>
            )}
          </>
        ) : (
          <>
            <PlainInput
              label="OpenAPI URL"
              hideLabel
              placeholder="https://example.com/openapi.yaml"
              defaultValue={url ?? ''}
              onChange={(value) => setUrl(value)}
            />
            <Button
              color="primary"
              disabled={trimmedUrl === '' || isLoading}
              isLoading={isLoading}
              size="sm"
              onClick={async () => {
                setIsLoading(true);
                try {
                  await importOpenApiUrl(trimmedUrl);
                } finally {
                  setIsLoading(false);
                }
              }}
            >
              {isLoading ? 'Importing' : 'Import'}
            </Button>
          </>
        )}
      </VStack>
    </VStack>
  );
}

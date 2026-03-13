import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { Button } from './core/Button';
import { VStack } from './core/Stacks';

interface Props {
  importData: (filePaths: string[]) => Promise<void>;
}

export function ImportDataDialog({ importData }: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [filePaths, setFilePaths] = useState<string[]>([]);

  const handleSelectFiles = async () => {
    const result = await open({ title: 'Select File(s)', multiple: true });
    if (result == null) return;
    setFilePaths(Array.isArray(result) ? result : [result]);
  };

  const fileCount = filePaths.length;

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
        <Button color="secondary" size="sm" onClick={handleSelectFiles}>
          {fileCount > 0
            ? `${fileCount} file${fileCount !== 1 ? 's' : ''} selected`
            : 'Select File(s)'}
        </Button>
        {fileCount > 0 && (
          <Button
            color="primary"
            disabled={isLoading}
            isLoading={isLoading}
            size="sm"
            onClick={async () => {
              setIsLoading(true);
              try {
                await importData(filePaths);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            {isLoading ? 'Importing' : 'Import'}
          </Button>
        )}
      </VStack>
    </VStack>
  );
}

import React, { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { Button } from './core/Button';
import { VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

interface Props {
  importData: (filePath: string) => Promise<void>;
}

export function ImportDataDialog({ importData }: Props) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [filePath, setFilePath] = useLocalStorage<string | null>('importFilePath', null);

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
                await importData(filePath);
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

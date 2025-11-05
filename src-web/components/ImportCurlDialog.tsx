import { useState } from 'react';
import { useImportCurl } from '../hooks/useImportCurl';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { Icon } from './core/Icon';
import { HStack, VStack } from './core/Stacks';

interface Props {
  hide: () => void;
}

const EXAMPLE_CURL = `curl https://api.example.com/users \\
  -H 'Authorization: Bearer token123' \\
  -H 'Content-Type: application/json' \\
  -d '{"name": "John Doe"}'`;

export function ImportCurlDialog({ hide }: Props) {
  const [curlCommand, setCurlCommand] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { mutate: importCurl } = useImportCurl();

  const handleImport = async () => {
    if (!curlCommand.trim()) {
      return;
    }

    // Basic validation
    if (!curlCommand.trim().toLowerCase().startsWith('curl')) {
      setError('Please paste a valid cURL command starting with "curl"');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      await importCurl({ command: curlCommand });
      hide();
    } catch (error) {
      console.error('Failed to import cURL:', error);
      setError('Failed to import cURL command. Please check the format and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <VStack space={4} className="h-full">
      {/* Info Banner */}
      <Banner color="info" className="text-sm">
        <VStack space={1.5}>
          <div className="flex items-start gap-2">
            <Icon icon="info" className="mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium mb-1">Paste your cURL command below</div>
              <div className="text-text-subtle">
                The command will be converted into a new HTTP request with all headers, body, and
                parameters preserved.
              </div>
            </div>
          </div>
        </VStack>
      </Banner>

      {/* Editor Section */}
      <VStack space={2} className="flex-1 min-h-0">
        <div className="text-sm font-medium text-text">cURL Command</div>
        <div className="flex-1 min-h-[280px] border border-border rounded-md overflow-hidden shadow-sm">
          <Editor
            heightMode="full"
            hideGutter
            language="text"
            placeholder={EXAMPLE_CURL}
            onChange={(value) => {
              setCurlCommand(value);
              if (error) setError(null);
            }}
            defaultValue={curlCommand}
            stateKey="import-curl-dialog"
          />
        </div>
      </VStack>

      {/* Error Message */}
      {error && (
        <Banner color="danger" className="text-sm">
          <div className="flex items-start gap-2">
            <Icon icon="alert_triangle" className="mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        </Banner>
      )}

      {/* Action Buttons */}
      <HStack space={2} justifyContent="end" className="pt-2 border-t border-border-subtle">
        <Button variant="border" onClick={hide} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          color="primary"
          onClick={handleImport}
          disabled={!curlCommand.trim() || isLoading}
          isLoading={isLoading}
          leftSlot={!isLoading && <Icon icon="import" />}
        >
          {isLoading ? 'Importing...' : 'Import Request'}
        </Button>
      </HStack>
    </VStack>
  );
}

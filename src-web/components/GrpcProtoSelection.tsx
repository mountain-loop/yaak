import { open } from '@tauri-apps/plugin-dialog';
import { useGrpc } from '../hooks/useGrpc';
import { useGrpcProtoFiles } from '../hooks/useGrpcProtoFiles';
import { useGrpcRequest } from '../hooks/useGrpcRequest';
import { pluralizeCount } from '../lib/pluralize';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { Link } from './core/Link';
import { HStack, VStack } from './core/Stacks';

interface Props {
  requestId: string;
  onDone: () => void;
}

export function GrpcProtoSelection({ requestId }: Props) {
  const request = useGrpcRequest(requestId);
  const protoFilesKv = useGrpcProtoFiles(requestId);
  const protoFiles = protoFilesKv.value ?? [];
  const grpc = useGrpc(request, null, protoFiles);
  const services = grpc.reflect.data;
  const serverReflection = protoFiles.length === 0 && services != null;
  let reflectError = grpc.reflect.error ?? null;
  const reflectionUnimplemented = `${reflectError}`.match(/unimplemented/i);

  if (reflectionUnimplemented) {
    reflectError = null;
  }

  if (request == null) {
    return null;
  }

  return (
    <VStack className="flex-col-reverse" space={3}>
      {/* Buttons on top so they get focus first */}
      <HStack space={2} justifyContent="start" className="flex-row-reverse">
        <Button
          color="primary"
          onClick={async () => {
            const selected = await open({
              title: 'Select Proto Files',
              multiple: true,
              filters: [{ name: 'Proto Files', extensions: ['proto'] }],
            });
            if (selected == null) return;

            const newFiles = selected.filter((p) => !protoFiles.includes(p));
            await protoFilesKv.set([...protoFiles, ...newFiles]);
            await grpc.reflect.refetch();
          }}
        >
          Add File
        </Button>
        <Button
          isLoading={grpc.reflect.isFetching}
          disabled={grpc.reflect.isFetching}
          color="secondary"
          onClick={() => grpc.reflect.refetch()}
        >
          Refresh Schema
        </Button>
      </HStack>
      <VStack space={5}>
        {!serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Found services{' '}
              {services?.slice(0, 5).map((s, i) => {
                return (
                  <span key={i}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? '' : i === services.length - 2 ? ' and ' : ', '}
                  </span>
                );
              })}
              {services?.length > 5 && pluralizeCount('other', services?.length - 5)}
            </p>
          </Banner>
        )}
        {serverReflection && services != null && services.length > 0 && (
          <Banner className="flex flex-col gap-2">
            <p>
              Server reflection found services
              {services?.map((s, i) => {
                return (
                  <span key={i}>
                    <InlineCode>{s.name}</InlineCode>
                    {i === services.length - 1 ? '' : i === services.length - 2 ? ' and ' : ', '}
                  </span>
                );
              })}
              . You can override this schema by manually selecting <InlineCode>*.proto</InlineCode>{' '}
              files.
            </p>
          </Banner>
        )}

        {protoFiles.length > 0 && (
          <table className="w-full divide-y divide-surface-highlight">
            <thead>
              <tr>
                <th className="text-text-subtlest">
                  <span className="font-mono">*.proto</span> Files
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-highlight">
              {protoFiles.map((f, i) => (
                <tr key={f + i} className="group">
                  <td className="pl-1 font-mono">{f.split('/').pop()}</td>
                  <td className="w-0 py-0.5">
                    <IconButton
                      title="Remove file"
                      icon="trash"
                      className="ml-auto opacity-50 transition-opacity group-hover:opacity-100"
                      onClick={async () => {
                        await protoFilesKv.set(protoFiles.filter((p) => p !== f));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reflectError && (
          <Banner color="warning">
            <h1 className="font-bold">
              Reflection failed on URL <InlineCode>{request.url || 'n/a'}</InlineCode>
            </h1>
            {reflectError}
          </Banner>
        )}
        {reflectionUnimplemented && protoFiles.length === 0 && (
          <Banner>
            <InlineCode>{request.url}</InlineCode> doesn&apos;t implement{' '}
            <Link href="https://github.com/grpc/grpc/blob/9aa3c5835a4ed6afae9455b63ed45c761d695bca/doc/server-reflection.md">
              Server Reflection
            </Link>{' '}
            . Please manually add the <InlineCode>.proto</InlineCode> file to get started.
          </Banner>
        )}
      </VStack>
    </VStack>
  );
}

import mime from 'mime';
import { useKeyValue } from '../hooks/useKeyValue';
import type { HttpRequest } from '@yaakapp-internal/models';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { HStack, VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

type Props = {
  requestId: string;
  contentType: string | null;
  body: HttpRequest['body'];
  onChange: (body: HttpRequest['body']) => void;
  onChangeContentType: (contentType: string | null) => void;
};

export function BinaryFileEditor({
  contentType,
  body,
  onChange,
  onChangeContentType,
  requestId,
}: Props) {
  const ignoreContentType = useKeyValue<boolean>({
    namespace: 'global',
    key: ['ignore_content_type', requestId],
    fallback: false,
  });

  const handleChange = async ({ filePath }: { filePath: string | null }) => {
    await ignoreContentType.set(false);
    onChange({ filePath: filePath ?? undefined });
  };

  const filePath = typeof body.filePath === 'string' ? body.filePath : null;
  const mimeType = mime.getType(filePath ?? '') ?? 'application/octet-stream';

  return (
    <VStack space={2}>
      <SelectFile onChange={handleChange} filePath={filePath} />
      {filePath != null && mimeType !== contentType && !ignoreContentType.value && (
        <Banner className="mt-3 !py-5">
          <div className="mb-4 text-center">
            <div>Set Content-Type header</div>
            <InlineCode>{mimeType}</InlineCode> for current request?
          </div>
          <HStack space={1.5} justifyContent="center">
            <Button size="sm" variant="border" onClick={() => ignoreContentType.set(true)}>
              Ignore
            </Button>
            <Button
              variant="solid"
              color="primary"
              size="sm"
              onClick={() => onChangeContentType(mimeType)}
            >
              Set Header
            </Button>
          </HStack>
        </Banner>
      )}
    </VStack>
  );
}

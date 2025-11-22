import type { HttpRequest } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import type { ReactNode } from 'react';
import { useToggle } from '../hooks/useToggle';
import { showConfirm } from '../lib/confirm';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Link } from './core/Link';
import { SizeTag } from './core/SizeTag';
import { HStack } from './core/Stacks';

interface Props {
  children: ReactNode;
  request: HttpRequest;
}

const LARGE_TEXT_BYTES = 2 * 1000 * 1000;

export function ConfirmLargeRequestBody({ children, request }: Props) {
  const [showLargeResponse, toggleShowLargeResponse] = useToggle();

  if (request.body?.text == null) {
    return children;
  }

  const contentLength = request.body.text.length ?? 0;
  const tooLargeBytes = LARGE_TEXT_BYTES;
  const isLarge = contentLength > tooLargeBytes;
  if (!showLargeResponse && isLarge) {
    return (
      <Banner color="primary" className="flex flex-col gap-3">
        <p>
          Rendering content over{' '}
          <InlineCode>
            <SizeTag contentLength={tooLargeBytes} />
          </InlineCode>{' '}
          may impact performance.
        </p>
        <p>
          See{' '}
          <Link href="https://feedback.yaak.app/en/help/articles/1198684-working-with-large-values">
            Working With Large Values
          </Link>{' '}
          for tips.
        </p>
        <HStack wrap space={2}>
          <Button color="primary" size="xs" onClick={toggleShowLargeResponse}>
            Reveal Body
          </Button>
          <Button
            color="danger"
            size="xs"
            variant="border"
            onClick={async () => {
              const confirm = await showConfirm({
                id: `delete-body-${request.id}`,
                confirmText: 'Delete Body',
                title: 'Delete Body Text',
                description: 'Are you sure you want to delete the request body text?',
                color: 'danger',
              });
              if (confirm) {
                await patchModel(request, { body: { ...request.body, text: '' } });
              }
            }}
          >
            Delete Body
          </Button>
        </HStack>
      </Banner>
    );
  }

  return <>{children}</>;
}

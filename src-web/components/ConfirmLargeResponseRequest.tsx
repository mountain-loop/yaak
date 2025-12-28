import type { HttpResponse } from '@yaakapp-internal/models';
import { type ReactNode, useMemo } from 'react';
import { getRequestBodyText as getHttpResponseRequestBodyText } from '../hooks/useHttpRequestBody';
import { useToggle } from '../hooks/useToggle';
import { isProbablyTextContentType } from '../lib/contentType';
import { getContentTypeFromHeaders } from '../lib/model_util';
import { CopyButton } from './CopyButton';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { SizeTag } from './core/SizeTag';
import { HStack } from './core/Stacks';

interface Props {
  children: ReactNode;
  response: HttpResponse;
}

const LARGE_BYTES = 2 * 1000 * 1000;

export function ConfirmLargeResponseRequest({ children, response }: Props) {
  const [showLargeResponse, toggleShowLargeResponse] = useToggle();
  const isProbablyText = useMemo(() => {
    const contentType = getContentTypeFromHeaders(response.headers);
    return isProbablyTextContentType(contentType);
  }, [response.headers]);

  const contentLength = response.requestContentLength ?? 0;
  const isLarge = contentLength > LARGE_BYTES;
  if (!showLargeResponse && isLarge) {
    return (
      <Banner color="primary" className="flex flex-col gap-3">
        <p>
          Showing content over{' '}
          <InlineCode>
            <SizeTag contentLength={LARGE_BYTES} />
          </InlineCode>{' '}
          may impact performance
        </p>
        <HStack wrap space={2}>
          <Button color="primary" size="xs" onClick={toggleShowLargeResponse}>
            Reveal Request Body
          </Button>
          {isProbablyText && (
            <CopyButton
              color="secondary"
              variant="border"
              size="xs"
              text={() => getHttpResponseRequestBodyText(response).then((d) => d?.bodyText ?? '')}
            />
          )}
        </HStack>
      </Banner>
    );
  }

  return <>{children}</>;
}

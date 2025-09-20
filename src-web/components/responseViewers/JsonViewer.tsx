import classNames from 'classnames';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';
import type { HttpResponse } from '@yaakapp-internal/models';
import { JsonAttributeTree } from '../core/JsonAttributeTree';

interface Props {
  response: HttpResponse;
  className?: string;
}

export function JsonViewer({ response, className }: Props) {
  const rawBody = useResponseBodyText({ response, filter: null });

  if (rawBody.isLoading || rawBody.data == null) return null;

  let parsed = {};
  try {
    parsed = JSON.parse(rawBody.data);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    // Nothing yet
  }

  return (
    <div className={classNames(className, 'overflow-x-auto h-full')}>
      <JsonAttributeTree attrValue={parsed} />
    </div>
  );
}

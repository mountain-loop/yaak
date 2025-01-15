import type { HttpResponse } from '@yaakapp-internal/models';
import React from 'react';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';

interface Props {
  response: HttpResponse;
}

export function SvgViewer({ response }: Props) {
  const rawTextBody = useResponseBodyText(response);
  if (rawTextBody.data == null) return null;
  const src = `data:image/svg+xml;base64,${btoa(rawTextBody.data)}`;
  return <img src={src} alt="Response preview" className="max-w-full max-h-full pb-2" />;
}

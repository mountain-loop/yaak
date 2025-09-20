import type { HttpResponse } from '@yaakapp-internal/models';
import React, { useEffect, useState } from 'react';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';

interface Props {
  response: HttpResponse;
}

export function SvgViewer({ response }: Props) {
  const rawTextBody = useResponseBodyText({ response, filter: null });
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!rawTextBody.data) {
      return setSrc(null);
    }

    const blob = new Blob([rawTextBody.data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setSrc(url);

    return () => URL.revokeObjectURL(url);
  }, [rawTextBody.data]);

  if (src == null) {
    return null;
  }

  return <img src={src} alt="Response preview" className="max-w-full max-h-full pb-2" />;
}

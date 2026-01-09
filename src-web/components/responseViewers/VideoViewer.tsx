import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

interface Props {
  bodyPath?: string;
  data?: Uint8Array;
}

export function VideoViewer({ bodyPath, data }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyPath) {
      setSrc(convertFileSrc(bodyPath));
    } else if (data) {
      const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data]);

  // biome-ignore lint/a11y/useMediaCaption: none
  return <video className="w-full" controls src={src} />;
}

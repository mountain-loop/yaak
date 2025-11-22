import { convertFileSrc } from '@tauri-apps/api/core';
import React from 'react';

interface Props {
  bodyPath: string;
}

export function AudioViewer({ bodyPath }: Props) {
  const src = convertFileSrc(bodyPath);

  // biome-ignore lint/a11y/useMediaCaption: <explanation>
  return <audio className="w-full" controls src={src} />;
}

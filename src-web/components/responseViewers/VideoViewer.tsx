import { convertFileSrc } from '@tauri-apps/api/core';
import React from 'react';

interface Props {
  bodyPath: string;
}

export function VideoViewer({ bodyPath }: Props) {
  const src = convertFileSrc(bodyPath);

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video className="w-full" controls src={src}></video>;
}

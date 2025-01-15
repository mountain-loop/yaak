import { convertFileSrc } from '@tauri-apps/api/core';
import React from 'react';

interface Props {
  bodyPath: string;
}

export function ImageViewer({ bodyPath }: Props) {
  const src = convertFileSrc(bodyPath);
  return <img src={src} alt="Response preview" className="max-w-full max-h-full pb-2" />;
}

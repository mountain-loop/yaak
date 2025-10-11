import { useQuery } from '@tanstack/react-query';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import classNames from 'classnames';
import React from 'react';

interface Props {
  src: string;
  className?: string;
}

export function LocalImage({ src: srcPath, className }: Props) {
  const src = useQuery({
    queryKey: ['local-image', srcPath],
    queryFn: async () => {
      const p = await resolveResource(srcPath);
      return convertFileSrc(p);
    },
  });

  return (
    <img
      src={src.data}
      alt="Response preview"
      className={classNames(
        className,
        'transition-opacity',
        src.data == null ? 'opacity-0' : 'opacity-100',
      )}
    />
  );
}

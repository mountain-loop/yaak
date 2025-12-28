import { convertFileSrc } from '@tauri-apps/api/core';
import classNames from 'classnames';
import { useEffect, useState } from 'react';

type Props = { className?: string } & (
  | {
      bodyPath: string;
    }
  | {
      data: ArrayBuffer;
    }
);

export function ImageViewer({ className, ...props }: Props) {
  const [src, setSrc] = useState<string>();
  const bodyPath = 'bodyPath' in props ? props.bodyPath : null;
  const data = 'data' in props ? props.data : null;

  useEffect(() => {
    if (bodyPath != null) {
      setSrc(convertFileSrc(bodyPath));
    } else if (data != null) {
      const blob = new Blob([data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data]);

  return (
    <img
      src={src}
      alt="Response preview"
      className={classNames(className, 'max-w-full max-h-full')}
    />
  );
}

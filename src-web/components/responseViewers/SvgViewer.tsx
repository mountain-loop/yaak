import { useEffect, useState } from 'react';

interface Props {
  text: string;
  className?: string;
}

export function SvgViewer({ text, className }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!text) {
      return setSrc(null);
    }

    const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setSrc(url);

    return () => URL.revokeObjectURL(url);
  }, [text]);

  if (src == null) {
    return null;
  }

  return (
    <img src={src} alt="Response preview" className={className ?? 'max-w-full max-h-full pb-2'} />
  );
}

import { formatSize } from '@yaakapp-internal/lib/formatSize';

interface Props {
  contentLength: number;
}

export function SizeTag({ contentLength }: Props) {
  return (
    <span className="font-mono" title={`${contentLength} bytes`}>
      {formatSize(contentLength)}
    </span>
  );
}

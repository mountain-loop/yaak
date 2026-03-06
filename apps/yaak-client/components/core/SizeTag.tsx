import { formatSize } from '@yaakapp-internal/lib/formatSize';

interface Props {
  contentLength: number;
  contentLengthCompressed?: number | null;
}

export function SizeTag({ contentLength, contentLengthCompressed }: Props) {
  return (
    <span
      className="font-mono"
      title={
        `${contentLength} bytes` +
        (contentLengthCompressed ? `\n${contentLengthCompressed} bytes compressed` : '')
      }
    >
      {formatSize(contentLength)}
    </span>
  );
}

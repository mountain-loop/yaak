import { formatSize } from "@yaakapp-internal/lib/formatSize";
import classNames from "classnames";

interface Props {
  className?: string;
  contentLength: number;
  contentLengthCompressed?: number | null;
}

export function SizeTag({ className, contentLength, contentLengthCompressed }: Props) {
  return (
    <span
      className={classNames("font-mono", className)}
      title={
        `${contentLength} bytes` +
        (contentLengthCompressed ? `\n${contentLengthCompressed} bytes compressed` : "")
      }
    >
      {formatSize(contentLength)}
    </span>
  );
}

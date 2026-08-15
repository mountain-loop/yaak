import classNames from "classnames";
import { useEffect, useState } from "react";

type Props = { className?: string; mimeType?: string } & (
  | {
      /** A URL the host resolved, for a body it already stored. */
      url: string;
    }
  | {
      data: ArrayBuffer;
    }
);

export function ImageViewer({ className, mimeType, ...props }: Props) {
  const [src, setSrc] = useState<string>();
  const url = "url" in props ? props.url : null;
  const data = "data" in props ? props.data : null;

  useEffect(() => {
    if (url != null) {
      setSrc(url);
    } else if (data != null) {
      const blob = new Blob([data], { type: mimeType ?? "image/png" });
      const objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setSrc(undefined);
    }
  }, [url, data, mimeType]);

  return (
    <img
      src={src}
      alt="Response preview"
      className={classNames(className, "max-w-full max-h-full")}
    />
  );
}

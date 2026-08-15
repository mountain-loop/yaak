import classNames from "classnames";
import { useEffect, useState } from "react";

type Props = { className?: string; mimeType?: string } & (
  | {
      /** A URL for the body the host already stored. */
      bodyUrl: string;
    }
  | {
      data: ArrayBuffer;
    }
);

export function ImageViewer({ className, mimeType, ...props }: Props) {
  const [src, setSrc] = useState<string>();
  const bodyUrl = "bodyUrl" in props ? props.bodyUrl : null;
  const data = "data" in props ? props.data : null;

  useEffect(() => {
    if (bodyUrl != null) {
      setSrc(bodyUrl);
    } else if (data != null) {
      const blob = new Blob([data], { type: mimeType ?? "image/png" });
      const objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setSrc(undefined);
    }
  }, [bodyUrl, data, mimeType]);

  return (
    <img
      src={src}
      alt="Response preview"
      className={classNames(className, "max-w-full max-h-full")}
    />
  );
}

import { useEffect, useState } from "react";
import { platform } from "@yaakapp-internal/platform";

interface Props {
  bodyPath?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export function VideoViewer({ bodyPath, data, mimeType }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyPath) {
      setSrc(platform.files.url(bodyPath));
    } else if (data) {
      // As in AudioViewer: a media element trusts the declared type instead of sniffing
      const blob = new Blob([new Uint8Array(data)], { type: mimeType ?? "video/mp4" });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data, mimeType]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <video className="w-full" controls src={src} />;
}

import { useEffect, useState } from "react";

interface Props {
  /** A URL the host resolved, for a body it already stored. */
  url?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export function VideoViewer({ url, data, mimeType }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (url) {
      setSrc(url);
    } else if (data) {
      // As in AudioViewer: a media element trusts the declared type instead of sniffing
      const blob = new Blob([new Uint8Array(data)], { type: mimeType ?? "video/mp4" });
      const objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setSrc(undefined);
    }
  }, [url, data, mimeType]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <video className="w-full" controls src={src} />;
}

import { useEffect, useState } from "react";

interface Props {
  /** A URL for the body the host already stored. */
  bodyUrl?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export function VideoViewer({ bodyUrl, data, mimeType }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyUrl) {
      setSrc(bodyUrl);
    } else if (data) {
      // As in AudioViewer: a media element trusts the declared type instead of sniffing
      const blob = new Blob([new Uint8Array(data)], { type: mimeType ?? "video/mp4" });
      const objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setSrc(undefined);
    }
  }, [bodyUrl, data, mimeType]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <video className="w-full" controls src={src} />;
}

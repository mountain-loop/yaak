import { useEffect, useState } from "react";

interface Props {
  /** A URL for the body the host already stored. */
  bodyUrl?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export function AudioViewer({ bodyUrl, data, mimeType }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyUrl) {
      setSrc(bodyUrl);
    } else if (data) {
      // The type matters here in a way it doesn't for an image: a media element goes by what
      // the blob declares rather than sniffing it, so an Ogg labelled as MP3 won't play
      const blob = new Blob([new Uint8Array(data)], { type: mimeType ?? "audio/mpeg" });
      const objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setSrc(undefined);
    }
  }, [bodyUrl, data, mimeType]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <audio className="w-full" controls src={src} />;
}

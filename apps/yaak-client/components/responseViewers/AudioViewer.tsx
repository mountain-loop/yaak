import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface Props {
  bodyPath?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export function AudioViewer({ bodyPath, data, mimeType }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyPath) {
      setSrc(convertFileSrc(bodyPath));
    } else if (data) {
      // The type matters here in a way it doesn't for an image: a media element goes by what
      // the blob declares rather than sniffing it, so an Ogg labelled as MP3 won't play
      const blob = new Blob([new Uint8Array(data)], { type: mimeType ?? "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data, mimeType]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <audio className="w-full" controls src={src} />;
}

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface Props {
  bodyPath?: string;
  data?: Uint8Array;
}

export function AudioViewer({ bodyPath, data }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (bodyPath) {
      setSrc(convertFileSrc(bodyPath));
    } else if (data) {
      const blob = new Blob([new Uint8Array(data)], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [bodyPath, data]);

  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <audio className="w-full" controls src={src} />;
}

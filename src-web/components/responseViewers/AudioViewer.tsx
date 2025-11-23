import { convertFileSrc } from '@tauri-apps/api/core';

interface Props {
  bodyPath: string;
}

export function AudioViewer({ bodyPath }: Props) {
  const src = convertFileSrc(bodyPath);

  // biome-ignore lint/a11y/useMediaCaption: none
  return <audio className="w-full" controls src={src} />;
}

import { convertFileSrc } from '@tauri-apps/api/core';

interface Props {
  bodyPath: string;
}

export function VideoViewer({ bodyPath }: Props) {
  const src = convertFileSrc(bodyPath);

  // biome-ignore lint/a11y/useMediaCaption: none
  return <video className="w-full" controls src={src} />;
}

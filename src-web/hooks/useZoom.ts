import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useCallback } from 'react';

export function useZoom() {
  const settings = useAtomValue(settingsAtom);

  const zoomIn = useCallback(async () => {
    if (!settings) return;
    await patchModel(settings, {
      interfaceScale: Math.min(1.8, settings.interfaceScale * 1.1),
    });
  }, [settings]);

  const zoomOut = useCallback(async () => {
    if (!settings) return;
    await patchModel(settings, {
      interfaceScale: Math.max(0.4, settings.interfaceScale * 0.9),
    });
  }, [settings]);

  const zoomReset = useCallback(async () => {
    await patchModel(settings, { interfaceScale: 1 });
  }, [settings]);

  return { zoomIn, zoomOut, zoomReset };
}

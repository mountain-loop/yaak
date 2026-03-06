import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { resolveAppearance } from '../lib/theme/appearance';
import { usePreferredAppearance } from './usePreferredAppearance';

export function useResolvedAppearance() {
  const preferredAppearance = usePreferredAppearance();
  const settings = useAtomValue(settingsAtom);
  return resolveAppearance(preferredAppearance, settings.appearance);
}

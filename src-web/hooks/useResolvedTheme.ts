import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { getResolvedTheme } from '../lib/theme/themes';
import { usePreferredAppearance } from './usePreferredAppearance';

export function useResolvedTheme() {
  const preferredAppearance = usePreferredAppearance();
  const settings = useAtomValue(settingsAtom);
  return getResolvedTheme(
    preferredAppearance,
    settings.appearance,
    settings.themeLight,
    settings.themeDark,
  );
}

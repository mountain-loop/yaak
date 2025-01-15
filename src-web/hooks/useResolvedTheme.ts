import { getResolvedTheme } from '../lib/theme/themes';
import { usePreferredAppearance } from './usePreferredAppearance';
import { useSettings } from './useSettings';

export function useResolvedTheme() {
  const preferredAppearance = usePreferredAppearance();
  const settings = useSettings();
  return getResolvedTheme(
    preferredAppearance,
    settings.appearance,
    settings.themeLight,
    settings.themeDark,
  );
}

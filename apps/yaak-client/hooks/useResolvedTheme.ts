import { useQuery } from '@tanstack/react-query';
import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { getResolvedTheme, getThemes } from '../lib/theme/themes';
import { usePluginsKey } from './usePlugins';
import { usePreferredAppearance } from './usePreferredAppearance';

export function useResolvedTheme() {
  const preferredAppearance = usePreferredAppearance();
  const settings = useAtomValue(settingsAtom);
  const pluginKey = usePluginsKey();
  return useQuery({
    placeholderData: (prev) => prev,
    queryKey: ['resolved_theme', preferredAppearance, settings.updatedAt, pluginKey],
    queryFn: async () => {
      const data = await getResolvedTheme(
        preferredAppearance,
        settings.appearance,
        settings.themeLight,
        settings.themeDark,
      );
      return { ...data, ...(await getThemes()) };
    },
  });
}

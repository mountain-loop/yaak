import { copyToClipboard } from '../lib/copy';
import { catppuccinMacchiato } from '../lib/theme/themes/catppuccin';
import { githubLight } from '../lib/theme/themes/github';
import { gruvboxDefault } from '../lib/theme/themes/gruvbox';
import { hotdogStandDefault } from '../lib/theme/themes/hotdog-stand';
import { monokaiProDefault } from '../lib/theme/themes/monokai-pro';
import { rosePineDefault } from '../lib/theme/themes/rose-pine';
import { yaakDark } from '../lib/theme/themes/yaak';
import { getThemeCSS } from '../lib/theme/window';
import { useListenToTauriEvent } from './useListenToTauriEvent';

export function useGenerateThemeCss() {
  useListenToTauriEvent('generate_theme_css', () => {
    const themesCss = [
      yaakDark,
      monokaiProDefault,
      rosePineDefault,
      catppuccinMacchiato,
      githubLight,
      gruvboxDefault,
      hotdogStandDefault,
    ]
      .map(getThemeCSS)
      .join('\n\n');
    copyToClipboard(themesCss);
  });
}

import type { YaakTheme } from '../window';
import { YaakColor } from '../yaakColor';

export const gruvboxDefault: YaakTheme = {
  id: 'gruvbox',
  name: 'gruvbox',
  surface: new YaakColor('#282828', 'dark'),             // Gruvbox bg
  surfaceHighlight: new YaakColor('#3c3836', 'dark'),    // Gruvbox bg1
  text: new YaakColor('#ebdbb2', 'dark'),                // Gruvbox fg
  textSubtle: new YaakColor('#fe8019', 'dark'),          // Gruvbox orange
  textSubtlest: new YaakColor('#665c54', 'dark'),        // Gruvbox bg4
  primary: new YaakColor('#d3869b', 'dark'),             // Gruvbox purple
  secondary: new YaakColor('#83a598', 'dark'),           // Gruvbox blue
  info: new YaakColor('#8ec07c', 'dark'),                // Gruvbox aqua
  success: new YaakColor('#b8bb26', 'dark'),             // Gruvbox green
  notice: new YaakColor('#fabd2f', 'dark'),              // Gruvbox yellow
  warning: new YaakColor('#fe8019', 'dark'),             // Gruvbox orange
  danger: new YaakColor('#fb4934', 'dark'),              // Gruvbox red
  components: {
    sidebar: {
      backdrop: new YaakColor('#282828', 'dark'),        // Gruvbox bg
    },
    appHeader: {
      backdrop: new YaakColor('#3c3836', 'dark'),        // Gruvbox bg1
    },
  },
};

export const gruvbox = [gruvboxDefault];

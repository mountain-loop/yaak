import type { YaakTheme } from '../window';
import { YaakColor } from '../yaakColor';

const nordDefault: YaakTheme = {
  id: 'nord',
  name: 'Nord',
  surface: new YaakColor('hsl(220, 16%, 22%)', 'dark'),          // Nord0 (#2e3440)
  surfaceHighlight: new YaakColor('hsl(220, 14%, 28%)', 'dark'), // Nord1 (#3b4252)
  text: new YaakColor('hsl(220, 28%, 93%)', 'dark'),             // Nord6 (#ECEFF4)
  textSubtle: new YaakColor('hsl(220, 26%, 90%)', 'dark'),       // Nord5 (#E5E9F0)
  textSubtlest: new YaakColor('hsl(220, 24%, 86%)', 'dark'),     // Nord4 (#D8DEE9)
  primary: new YaakColor('hsl(193, 38%, 68%)', 'dark'),          // Nord8 (#88C0D0)
  secondary: new YaakColor('hsl(210, 34%, 63%)', 'dark'),        // Nord9 (#81A1C1)
  info: new YaakColor('hsl(174, 25%, 69%)', 'dark'),             // Nord7 (#8FBCBB)
  success: new YaakColor('hsl(89, 26%, 66%)', 'dark'),           // Nord14 (#A3BE8C)
  notice: new YaakColor('hsl(40, 66%, 73%)', 'dark'),            // Nord13 (#EBCB8B)
  warning: new YaakColor('hsl(17, 48%, 64%)', 'dark'),           // Nord12 (#D08770)
  danger: new YaakColor('hsl(353, 43%, 56%)', 'dark'),           // Nord11 (#BF616A)
  components: {
    sidebar: {
      backdrop: new YaakColor('hsl(220, 16%, 22%)', 'dark'),     // Nord0 (#2e3440)
    },
    appHeader: {
      backdrop: new YaakColor('hsl(220, 14%, 28%)', 'dark'),     // Nord1 (#3b4252)
    },
  },
};

export const nord = [nordDefault];


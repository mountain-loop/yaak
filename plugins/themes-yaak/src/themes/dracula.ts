import type { Theme } from '@yaakapp/api';

export const dracula: Theme = {
  id: 'dracula',
  label: 'Dracula',
  dark: true,
  base: {
    surface: 'hsl(231,15%,18%)',
    surfaceHighlight: 'hsl(230,15%,24%)',
    text: 'hsl(60,30%,96%)',
    textSubtle: 'hsl(232,14%,65%)',
    textSubtlest: 'hsl(232,14%,50%)',
    primary: 'hsl(265,89%,78%)',
    secondary: 'hsl(225,27%,51%)',
    info: 'hsl(191,97%,77%)',
    success: 'hsl(135,94%,65%)',
    notice: 'hsl(65,92%,76%)',
    warning: 'hsl(31,100%,71%)',
    danger: 'hsl(0,100%,67%)',
  },
  components: {
    sidebar: {
      backdrop: 'hsl(230,15%,24%)',
    },
    appHeader: {
      backdrop: 'hsl(235,14%,15%)',
    },
  },
};

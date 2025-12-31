import type { Theme } from '@yaakapp/api';

export const moonlight: Theme = {
  id: 'moonlight',
  label: 'Moonlight',
  dark: true,
  base: {
    surface: 'hsl(234,23%,17%)',
    text: 'hsl(225,71%,90%)',
    textSubtle: 'hsl(230,28%,62%)',
    textSubtlest: 'hsl(232,26%,43%)',
    primary: 'hsl(262,100%,82%)',
    secondary: 'hsl(232,18%,65%)',
    info: 'hsl(217,100%,74%)',
    success: 'hsl(174,66%,54%)',
    notice: 'hsl(35,100%,73%)',
    warning: 'hsl(17,100%,71%)',
    danger: 'hsl(356,100%,73%)',
  },
  components: {
    appHeader: {
      surface: 'hsl(233,23%,15%)',
    },
    sidebar: {
      surface: 'hsl(233,23%,15%)',
    },
  },
};

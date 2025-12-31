import type { Theme } from '@yaakapp/api';

export const gruvbox: Theme = {
  id: 'gruvbox',
  label: 'Gruvbox',
  dark: true,
  base: {
    surface: 'hsl(0,0%,16%)',
    surfaceHighlight: 'hsl(20,3%,19%)',
    text: 'hsl(53,74%,91%)',
    textSubtle: 'hsl(39,24%,66%)',
    textSubtlest: 'hsl(30,12%,51%)',
    primary: 'hsl(344,47%,68%)',
    secondary: 'hsl(157,16%,58%)',
    info: 'hsl(104,35%,62%)',
    success: 'hsl(61,66%,44%)',
    notice: 'hsl(42,95%,58%)',
    warning: 'hsl(27,99%,55%)',
    danger: 'hsl(6,96%,59%)',
  },
};

import type { Theme } from '@yaakapp/api';

export const relaxing: Theme = {
  id: 'relaxing',
  label: 'Relaxing',
  dark: true,
  base: {
    surface: 'hsl(267,33%,17%)',
    text: 'hsl(275,49%,92%)',
    primary: 'hsl(267,84%,81%)',
    secondary: 'hsl(227,35%,80%)',
    info: 'hsl(217,92%,76%)',
    success: 'hsl(115,54%,76%)',
    notice: 'hsl(41,86%,83%)',
    warning: 'hsl(23,92%,75%)',
    danger: 'hsl(343,81%,75%)',
  },
};

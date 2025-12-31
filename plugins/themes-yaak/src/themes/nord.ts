import type { Theme } from '@yaakapp/api';

export const nord: Theme = {
  id: 'nord',
  label: 'Nord',
  dark: true,
  base: {
    surface: 'hsl(220,16%,22%)',
    surfaceHighlight: 'hsl(220,14%,28%)',
    text: 'hsl(220,28%,93%)',
    textSubtle: 'hsl(220,26%,90%)',
    textSubtlest: 'hsl(220,24%,86%)',
    primary: 'hsl(193,38%,68%)',
    secondary: 'hsl(210,34%,63%)',
    info: 'hsl(174,25%,69%)',
    success: 'hsl(89,26%,66%)',
    notice: 'hsl(40,66%,73%)',
    warning: 'hsl(17,48%,64%)',
    danger: 'hsl(353,43%,56%)',
  },
  components: {
    sidebar: {
      backdrop: 'hsl(220,16%,22%)',
    },
    appHeader: {
      backdrop: 'hsl(220,14%,28%)',
    },
  },
};

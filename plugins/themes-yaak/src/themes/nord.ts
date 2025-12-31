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

export const nordLight: Theme = {
  id: 'nord-light',
  label: 'Nord Light',
  dark: false,
  base: {
    surface: 'hsl(220,27%,98%)',
    surfaceHighlight: 'hsl(220,24%,94%)',
    text: 'hsl(220,16%,22%)',
    textSubtle: 'hsl(220,15%,30%)',
    textSubtlest: 'hsl(220,14%,40%)',
    primary: 'hsl(193,43%,52%)',
    secondary: 'hsl(210,34%,54%)',
    info: 'hsl(179,25%,50%)',
    success: 'hsl(92,28%,48%)',
    notice: 'hsl(40,71%,52%)',
    warning: 'hsl(14,51%,53%)',
    danger: 'hsl(354,42%,56%)',
  },
  components: {
    sidebar: {
      backdrop: 'hsl(220,24%,94%)',
    },
    appHeader: {
      backdrop: 'hsl(220,27%,98%)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const horizon: Theme = {
  id: 'horizon',
  label: 'Horizon',
  dark: true,
  base: {
    surface: 'hsl(220, 16%, 13%)',
    surfaceHighlight: 'hsl(220, 14%, 18%)',
    text: 'hsl(220, 15%, 85%)',
    textSubtle: 'hsl(220, 10%, 55%)',
    textSubtlest: 'hsl(220, 8%, 45%)',
    primary: 'hsl(5, 85%, 68%)',
    secondary: 'hsl(220, 10%, 55%)',
    info: 'hsl(217, 70%, 68%)',
    success: 'hsl(92, 50%, 60%)',
    notice: 'hsl(34, 92%, 70%)',
    warning: 'hsl(20, 90%, 65%)',
    danger: 'hsl(355, 80%, 65%)',
  },
  components: {
    dialog: {
      surface: 'hsl(220, 16%, 10%)',
    },
    sidebar: {
      surface: 'hsl(220, 14%, 15%)',
      border: 'hsl(220, 14%, 19%)',
    },
    appHeader: {
      surface: 'hsl(220, 16%, 11%)',
      border: 'hsl(220, 14%, 17%)',
    },
    responsePane: {
      surface: 'hsl(220, 14%, 15%)',
      border: 'hsl(220, 14%, 19%)',
    },
    button: {
      primary: 'hsl(5, 85%, 61%)',
      secondary: 'hsl(224,8%,53%)',
      info: 'hsl(217, 70%, 61%)',
      success: 'hsl(92, 50%, 53%)',
      notice: 'hsl(34, 92%, 63%)',
      warning: 'hsl(20, 90%, 58%)',
      danger: 'hsl(355, 80%, 58%)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const winterIsComing: Theme = {
  id: 'winter-is-coming',
  label: 'Winter is Coming',
  dark: true,
  base: {
    surface: 'hsl(216, 50%, 10%)',
    surfaceHighlight: 'hsl(216, 40%, 15%)',
    text: 'hsl(210, 20%, 88%)',
    textSubtle: 'hsl(210, 15%, 60%)',
    textSubtlest: 'hsl(210, 10%, 45%)',
    primary: 'hsl(176, 85%, 60%)',
    secondary: 'hsl(210, 15%, 60%)',
    info: 'hsl(210, 65%, 65%)',
    success: 'hsl(100, 65%, 55%)',
    notice: 'hsl(45, 100%, 65%)',
    warning: 'hsl(30, 90%, 55%)',
    danger: 'hsl(350, 100%, 65%)',
  },
  components: {
    dialog: {
      surface: 'hsl(216, 50%, 7%)',
    },
    sidebar: {
      surface: 'hsl(216, 45%, 12%)',
      border: 'hsl(216, 40%, 17%)',
    },
    appHeader: {
      surface: 'hsl(216, 50%, 8%)',
      border: 'hsl(216, 40%, 14%)',
    },
    responsePane: {
      surface: 'hsl(216, 45%, 12%)',
      border: 'hsl(216, 40%, 17%)',
    },
    button: {
      primary: 'hsl(176, 85%, 53%)',
      secondary: 'hsl(210, 15%, 53%)',
      info: 'hsl(210, 65%, 58%)',
      success: 'hsl(100, 65%, 48%)',
      notice: 'hsl(45, 100%, 58%)',
      warning: 'hsl(30, 90%, 48%)',
      danger: 'hsl(350, 100%, 58%)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const winterIsComing: Theme = {
  id: 'vscode-winter-is-coming',
  label: 'Winter is Coming',
  dark: true,
  base: {
    surface: 'hsl(216, 50%, 10%)', // #011627 (similar to Night Owl)
    surfaceHighlight: 'hsl(216, 40%, 15%)',
    text: 'hsl(210, 20%, 88%)', // #d6deeb
    textSubtle: 'hsl(210, 15%, 60%)',
    textSubtlest: 'hsl(210, 10%, 45%)',
    primary: 'hsl(176, 85%, 60%)', // #4EC9B0 (teal)
    secondary: 'hsl(210, 65%, 65%)', // #87CEFA (light blue)
    info: 'hsl(210, 65%, 65%)', // #87CEFA
    success: 'hsl(100, 65%, 55%)', // #5db66f (green)
    notice: 'hsl(45, 100%, 65%)', // #DCDCAA (yellow)
    warning: 'hsl(30, 90%, 55%)', // #ce9178 (orange)
    danger: 'hsl(350, 100%, 65%)', // #F14C4C (red)
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
      secondary: 'hsl(210, 65%, 58%)',
      info: 'hsl(210, 65%, 58%)',
      success: 'hsl(100, 65%, 48%)',
      notice: 'hsl(45, 100%, 58%)',
      warning: 'hsl(30, 90%, 48%)',
      danger: 'hsl(350, 100%, 58%)',
    },
  },
};

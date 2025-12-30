import type { Theme } from '@yaakapp/api';

export const materialOcean: Theme = {
  id: 'vscode-material-ocean',
  label: 'Material Ocean',
  dark: true,
  base: {
    surface: 'hsl(230, 25%, 14%)', // #0F111A
    surfaceHighlight: 'hsl(230, 20%, 18%)',
    text: 'hsl(220, 53%, 85%)', // #8F93A2 lighter
    textSubtle: 'hsl(228, 12%, 54%)',
    textSubtlest: 'hsl(228, 12%, 42%)',
    primary: 'hsl(262, 100%, 75%)', // #c792ea (purple)
    secondary: 'hsl(228, 12%, 60%)',
    info: 'hsl(224, 100%, 75%)', // #82aaff
    success: 'hsl(84, 60%, 73%)', // #c3e88d
    notice: 'hsl(43, 100%, 70%)', // #ffcb6b
    warning: 'hsl(14, 85%, 70%)', // #f78c6c
    danger: 'hsl(1, 77%, 59%)', // #ff5370
  },
  components: {
    sidebar: {
      surface: 'hsl(230, 25%, 12%)',
      border: 'hsl(230, 20%, 18%)',
    },
    appHeader: {
      surface: 'hsl(230, 25%, 10%)',
      border: 'hsl(230, 20%, 16%)',
    },
    responsePane: {
      surface: 'hsl(230, 25%, 12%)',
      border: 'hsl(230, 20%, 18%)',
    },
    button: {
      primary: 'hsl(262, 100%, 68%)',
      info: 'hsl(224, 100%, 68%)',
      success: 'hsl(84, 60%, 66%)',
      notice: 'hsl(43, 100%, 63%)',
      warning: 'hsl(14, 85%, 63%)',
      danger: 'hsl(1, 77%, 52%)',
    },
  },
};

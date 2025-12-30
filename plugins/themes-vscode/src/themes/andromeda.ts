import type { Theme } from '@yaakapp/api';

export const andromeda: Theme = {
  id: 'vscode-andromeda',
  label: 'Andromeda',
  dark: true,
  base: {
    surface: 'hsl(251, 25%, 15%)', // #23262E
    surfaceHighlight: 'hsl(251, 22%, 20%)',
    text: 'hsl(220, 10%, 85%)', // #D5CED9
    textSubtle: 'hsl(220, 8%, 60%)',
    textSubtlest: 'hsl(220, 6%, 45%)',
    primary: 'hsl(293, 75%, 68%)', // #ee5d98 (pink/magenta)
    secondary: 'hsl(180, 60%, 60%)', // #00e8c6 (teal)
    info: 'hsl(180, 60%, 60%)', // #00e8c6 (teal)
    success: 'hsl(85, 60%, 55%)', // #96E072 (green)
    notice: 'hsl(38, 100%, 65%)', // #ffe66d (yellow)
    warning: 'hsl(25, 95%, 60%)', // #f39c12 (orange)
    danger: 'hsl(358, 80%, 60%)', // #f44747 (red)
  },
  components: {
    dialog: {
      surface: 'hsl(251, 25%, 12%)',
    },
    sidebar: {
      surface: 'hsl(251, 23%, 13%)',
      border: 'hsl(251, 20%, 18%)',
    },
    appHeader: {
      surface: 'hsl(251, 25%, 11%)',
      border: 'hsl(251, 20%, 16%)',
    },
    responsePane: {
      surface: 'hsl(251, 23%, 13%)',
      border: 'hsl(251, 20%, 18%)',
    },
    button: {
      primary: 'hsl(293, 75%, 61%)',
      secondary: 'hsl(180, 60%, 53%)',
      info: 'hsl(180, 60%, 53%)',
      success: 'hsl(85, 60%, 48%)',
      notice: 'hsl(38, 100%, 58%)',
      warning: 'hsl(25, 95%, 53%)',
      danger: 'hsl(358, 80%, 53%)',
    },
  },
};

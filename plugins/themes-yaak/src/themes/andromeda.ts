import type { Theme } from '@yaakapp/api';

export const andromeda: Theme = {
  id: 'andromeda',
  label: 'Andromeda',
  dark: true,
  base: {
    surface: 'hsl(251, 25%, 15%)',
    surfaceHighlight: 'hsl(251, 22%, 20%)',
    text: 'hsl(220, 10%, 85%)',
    textSubtle: 'hsl(220, 8%, 60%)',
    textSubtlest: 'hsl(220, 6%, 45%)',
    primary: 'hsl(293, 75%, 68%)',
    secondary: 'hsl(220, 8%, 60%)',
    info: 'hsl(180, 60%, 60%)',
    success: 'hsl(85, 60%, 55%)',
    notice: 'hsl(38, 100%, 65%)',
    warning: 'hsl(25, 95%, 60%)',
    danger: 'hsl(358, 80%, 60%)',
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
      secondary: 'hsl(220, 8%, 53%)',
      info: 'hsl(180, 60%, 53%)',
      success: 'hsl(85, 60%, 48%)',
      notice: 'hsl(38, 100%, 58%)',
      warning: 'hsl(25, 95%, 53%)',
      danger: 'hsl(358, 80%, 53%)',
    },
  },
};

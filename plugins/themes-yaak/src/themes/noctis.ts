import type { Theme } from '@yaakapp/api';

export const noctisAzureus: Theme = {
  id: 'noctis-azureus',
  label: 'Noctis Azureus',
  dark: true,
  base: {
    surface: 'hsl(210, 35%, 14%)',
    surfaceHighlight: 'hsl(210, 30%, 19%)',
    text: 'hsl(180, 45%, 85%)',
    textSubtle: 'hsl(180, 25%, 60%)',
    textSubtlest: 'hsl(180, 18%, 45%)',
    primary: 'hsl(175, 60%, 55%)',
    secondary: 'hsl(200, 70%, 65%)',
    info: 'hsl(200, 70%, 65%)',
    success: 'hsl(85, 55%, 60%)',
    notice: 'hsl(45, 90%, 60%)',
    warning: 'hsl(25, 85%, 58%)',
    danger: 'hsl(355, 75%, 62%)',
  },
  components: {
    dialog: {
      surface: 'hsl(210, 35%, 11%)',
    },
    sidebar: {
      surface: 'hsl(210, 33%, 12%)',
      border: 'hsl(210, 30%, 17%)',
    },
    appHeader: {
      surface: 'hsl(210, 35%, 10%)',
      border: 'hsl(210, 30%, 15%)',
    },
    responsePane: {
      surface: 'hsl(210, 33%, 12%)',
      border: 'hsl(210, 30%, 17%)',
    },
    button: {
      primary: 'hsl(175, 60%, 48%)',
      secondary: 'hsl(200, 70%, 58%)',
      info: 'hsl(200, 70%, 58%)',
      success: 'hsl(85, 55%, 53%)',
      notice: 'hsl(45, 90%, 53%)',
      warning: 'hsl(25, 85%, 51%)',
      danger: 'hsl(355, 75%, 55%)',
    },
  },
};

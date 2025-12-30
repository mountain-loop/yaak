import type { Theme } from '@yaakapp/api';

export const horizon: Theme = {
  id: 'vscode-horizon',
  label: 'Horizon',
  dark: true,
  base: {
    surface: 'hsl(220, 16%, 13%)', // #1c1e26
    surfaceHighlight: 'hsl(220, 14%, 18%)',
    text: 'hsl(220, 15%, 85%)', // #d5d8da
    textSubtle: 'hsl(220, 10%, 55%)',
    textSubtlest: 'hsl(220, 8%, 45%)',
    primary: 'hsl(5, 85%, 68%)', // #e95678 (pink/red)
    secondary: 'hsl(34, 92%, 70%)', // #fab795 (orange)
    info: 'hsl(217, 70%, 68%)', // #6c9cdb (blue)
    success: 'hsl(92, 50%, 60%)', // #09f7a0 (green/teal)
    notice: 'hsl(34, 92%, 70%)', // #fab795 (orange)
    warning: 'hsl(20, 90%, 65%)', // #f09483 (salmon)
    danger: 'hsl(355, 80%, 65%)', // #e95678 (red)
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
      secondary: 'hsl(34, 92%, 63%)',
      info: 'hsl(217, 70%, 61%)',
      success: 'hsl(92, 50%, 53%)',
      notice: 'hsl(34, 92%, 63%)',
      warning: 'hsl(20, 90%, 58%)',
      danger: 'hsl(355, 80%, 58%)',
    },
  },
};

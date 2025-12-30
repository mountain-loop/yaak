import type { Theme } from '@yaakapp/api';

export const pandaSyntax: Theme = {
  id: 'vscode-panda',
  label: 'Panda Syntax',
  dark: true,
  base: {
    surface: 'hsl(225, 15%, 15%)', // #292A2B
    surfaceHighlight: 'hsl(225, 12%, 20%)',
    text: 'hsl(0, 0%, 90%)', // #E6E6E6
    textSubtle: 'hsl(0, 0%, 65%)',
    textSubtlest: 'hsl(0, 0%, 50%)',
    primary: 'hsl(353, 95%, 70%)', // #FF75B5 (pink)
    secondary: 'hsl(175, 90%, 65%)', // #19f9d8 (teal)
    info: 'hsl(200, 85%, 65%)', // #45A9F9 (blue)
    success: 'hsl(175, 90%, 65%)', // #19f9d8 (teal)
    notice: 'hsl(40, 100%, 65%)', // #FFB86C (orange)
    warning: 'hsl(40, 100%, 65%)', // #FFB86C (orange)
    danger: 'hsl(0, 90%, 65%)', // #FF2C6D (red)
  },
  components: {
    dialog: {
      surface: 'hsl(225, 15%, 12%)',
    },
    sidebar: {
      surface: 'hsl(225, 14%, 13%)',
      border: 'hsl(225, 12%, 18%)',
    },
    appHeader: {
      surface: 'hsl(225, 15%, 11%)',
      border: 'hsl(225, 12%, 16%)',
    },
    responsePane: {
      surface: 'hsl(225, 14%, 13%)',
      border: 'hsl(225, 12%, 18%)',
    },
    button: {
      primary: 'hsl(353, 95%, 63%)',
      secondary: 'hsl(175, 90%, 58%)',
      info: 'hsl(200, 85%, 58%)',
      success: 'hsl(175, 90%, 58%)',
      notice: 'hsl(40, 100%, 58%)',
      warning: 'hsl(40, 100%, 58%)',
      danger: 'hsl(0, 90%, 58%)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const materialDarker: Theme = {
  id: 'vscode-material-darker',
  label: 'Material Darker',
  dark: true,
  base: {
    surface: 'hsl(0, 0%, 13%)', // #212121
    surfaceHighlight: 'hsl(0, 0%, 18%)',
    text: 'hsl(0, 0%, 93%)', // #EEFFFF
    textSubtle: 'hsl(0, 0%, 65%)',
    textSubtlest: 'hsl(0, 0%, 50%)',
    primary: 'hsl(262, 100%, 75%)', // #c792ea
    secondary: 'hsl(0, 0%, 60%)',
    info: 'hsl(224, 100%, 75%)', // #82aaff
    success: 'hsl(84, 60%, 73%)', // #c3e88d
    notice: 'hsl(43, 100%, 70%)', // #ffcb6b
    warning: 'hsl(14, 85%, 70%)', // #f78c6c
    danger: 'hsl(1, 77%, 59%)', // #ff5370
  },
  components: {
    sidebar: {
      surface: 'hsl(0, 0%, 11%)',
      border: 'hsl(0, 0%, 16%)',
    },
    appHeader: {
      surface: 'hsl(0, 0%, 9%)',
      border: 'hsl(0, 0%, 14%)',
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

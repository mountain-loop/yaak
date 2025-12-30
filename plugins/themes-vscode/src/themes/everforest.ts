import type { Theme } from '@yaakapp/api';

export const everforestDark: Theme = {
  id: 'vscode-everforest-dark',
  label: 'Everforest Dark',
  dark: true,
  base: {
    surface: 'hsl(150, 8%, 18%)', // #2d353b
    surfaceHighlight: 'hsl(150, 7%, 22%)',
    text: 'hsl(45, 30%, 78%)', // #d3c6aa
    textSubtle: 'hsl(145, 8%, 55%)', // #859289
    textSubtlest: 'hsl(145, 6%, 42%)',
    primary: 'hsl(142, 35%, 60%)', // #a7c080 (green)
    secondary: 'hsl(165, 25%, 55%)', // #83c092 (aqua)
    info: 'hsl(200, 35%, 65%)', // #7fbbb3 (blue)
    success: 'hsl(142, 35%, 60%)', // #a7c080 (green)
    notice: 'hsl(46, 55%, 68%)', // #dbbc7f (yellow)
    warning: 'hsl(24, 55%, 65%)', // #e69875 (orange)
    danger: 'hsl(358, 50%, 68%)', // #e67e80 (red)
  },
  components: {
    dialog: {
      surface: 'hsl(150, 8%, 15%)',
    },
    sidebar: {
      surface: 'hsl(150, 7%, 16%)',
      border: 'hsl(150, 6%, 20%)',
    },
    appHeader: {
      surface: 'hsl(150, 8%, 14%)',
      border: 'hsl(150, 6%, 18%)',
    },
    responsePane: {
      surface: 'hsl(150, 7%, 16%)',
      border: 'hsl(150, 6%, 20%)',
    },
    button: {
      primary: 'hsl(142, 35%, 53%)',
      secondary: 'hsl(165, 25%, 48%)',
      info: 'hsl(200, 35%, 58%)',
      success: 'hsl(142, 35%, 53%)',
      notice: 'hsl(46, 55%, 61%)',
      warning: 'hsl(24, 55%, 58%)',
      danger: 'hsl(358, 50%, 61%)',
    },
  },
};

export const everforestLight: Theme = {
  id: 'vscode-everforest-light',
  label: 'Everforest Light',
  dark: false,
  base: {
    surface: 'hsl(40, 32%, 93%)', // #fdf6e3
    surfaceHighlight: 'hsl(40, 28%, 89%)',
    text: 'hsl(135, 8%, 35%)', // #5c6a72
    textSubtle: 'hsl(135, 6%, 45%)',
    textSubtlest: 'hsl(135, 4%, 55%)',
    primary: 'hsl(128, 30%, 45%)', // #8da101 (green)
    secondary: 'hsl(165, 25%, 40%)', // #35a77c (aqua)
    info: 'hsl(200, 35%, 45%)', // #3a94c5 (blue)
    success: 'hsl(128, 30%, 45%)', // #8da101 (green)
    notice: 'hsl(45, 70%, 40%)', // #dfa000 (yellow)
    warning: 'hsl(22, 60%, 48%)', // #f57d26 (orange)
    danger: 'hsl(355, 55%, 50%)', // #f85552 (red)
  },
  components: {
    sidebar: {
      surface: 'hsl(40, 30%, 91%)',
      border: 'hsl(40, 25%, 86%)',
    },
    appHeader: {
      surface: 'hsl(40, 30%, 89%)',
      border: 'hsl(40, 25%, 84%)',
    },
  },
};

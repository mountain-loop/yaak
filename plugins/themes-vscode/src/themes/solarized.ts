import type { Theme } from '@yaakapp/api';

export const solarizedDark: Theme = {
  id: 'vscode-solarized-dark',
  label: 'Solarized Dark',
  dark: true,
  base: {
    surface: 'hsl(192, 100%, 11%)', // #002b36 (base03)
    surfaceHighlight: 'hsl(192, 90%, 14%)', // #073642 (base02)
    text: 'hsl(186, 8%, 55%)', // #839496 (base0)
    textSubtle: 'hsl(194, 14%, 40%)', // #657b83 (base00)
    textSubtlest: 'hsl(195, 12%, 35%)',
    primary: 'hsl(237, 43%, 60%)', // #6c71c4 (violet)
    secondary: 'hsl(186, 8%, 50%)',
    info: 'hsl(205, 69%, 49%)', // #268bd2 (blue)
    success: 'hsl(68, 100%, 30%)', // #859900 (green)
    notice: 'hsl(45, 100%, 35%)', // #b58900 (yellow)
    warning: 'hsl(18, 89%, 44%)', // #cb4b16 (orange)
    danger: 'hsl(1, 71%, 52%)', // #dc322f (red)
  },
  components: {
    dialog: {
      surface: 'hsl(192, 100%, 8%)',
    },
    sidebar: {
      surface: 'hsl(192, 90%, 14%)',
      border: 'hsl(192, 80%, 18%)',
    },
    appHeader: {
      surface: 'hsl(192, 100%, 9%)',
      border: 'hsl(192, 80%, 15%)',
    },
    responsePane: {
      surface: 'hsl(192, 90%, 14%)',
      border: 'hsl(192, 80%, 18%)',
    },
    button: {
      primary: 'hsl(237, 43%, 53%)',
      info: 'hsl(205, 69%, 43%)',
      success: 'hsl(68, 100%, 25%)',
      notice: 'hsl(45, 100%, 30%)',
      warning: 'hsl(18, 89%, 38%)',
      danger: 'hsl(1, 71%, 46%)',
    },
  },
};

export const solarizedLight: Theme = {
  id: 'vscode-solarized-light',
  label: 'Solarized Light',
  dark: false,
  base: {
    surface: 'hsl(44, 87%, 94%)', // #fdf6e3 (base3)
    surfaceHighlight: 'hsl(44, 45%, 90%)', // #eee8d5 (base2)
    text: 'hsl(194, 14%, 40%)', // #657b83 (base00)
    textSubtle: 'hsl(195, 12%, 46%)', // #586e75 (base01)
    textSubtlest: 'hsl(186, 8%, 55%)',
    primary: 'hsl(237, 43%, 60%)', // #6c71c4 (violet)
    secondary: 'hsl(194, 14%, 45%)',
    info: 'hsl(205, 69%, 49%)', // #268bd2 (blue)
    success: 'hsl(68, 100%, 30%)', // #859900 (green)
    notice: 'hsl(45, 100%, 35%)', // #b58900 (yellow)
    warning: 'hsl(18, 89%, 44%)', // #cb4b16 (orange)
    danger: 'hsl(1, 71%, 52%)', // #dc322f (red)
  },
  components: {
    sidebar: {
      surface: 'hsl(44, 45%, 90%)',
      border: 'hsl(44, 30%, 85%)',
    },
    appHeader: {
      surface: 'hsl(44, 45%, 88%)',
      border: 'hsl(44, 30%, 83%)',
    },
  },
};

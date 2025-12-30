import type { Theme } from '@yaakapp/api';

export const blulocoDark: Theme = {
  id: 'vscode-bluloco-dark',
  label: 'Bluloco Dark',
  dark: true,
  base: {
    surface: 'hsl(230, 20%, 14%)', // #282c34
    surfaceHighlight: 'hsl(230, 17%, 19%)',
    text: 'hsl(220, 15%, 80%)', // #abb2c0
    textSubtle: 'hsl(220, 10%, 55%)',
    textSubtlest: 'hsl(220, 8%, 42%)',
    primary: 'hsl(218, 85%, 65%)', // #3691ff (blue)
    secondary: 'hsl(281, 60%, 65%)', // #ce77fc (purple)
    info: 'hsl(218, 85%, 65%)', // blue
    success: 'hsl(95, 55%, 55%)', // #42d392 (green)
    notice: 'hsl(37, 90%, 60%)', // #fc9544 (yellow/orange)
    warning: 'hsl(22, 85%, 55%)', // #fc7344 (orange)
    danger: 'hsl(355, 75%, 60%)', // #ff6480 (red/pink)
  },
  components: {
    dialog: {
      surface: 'hsl(230, 20%, 11%)',
    },
    sidebar: {
      surface: 'hsl(230, 18%, 12%)',
      border: 'hsl(230, 16%, 17%)',
    },
    appHeader: {
      surface: 'hsl(230, 20%, 10%)',
      border: 'hsl(230, 16%, 15%)',
    },
    responsePane: {
      surface: 'hsl(230, 18%, 12%)',
      border: 'hsl(230, 16%, 17%)',
    },
    button: {
      primary: 'hsl(218, 85%, 58%)',
      secondary: 'hsl(281, 60%, 58%)',
      info: 'hsl(218, 85%, 58%)',
      success: 'hsl(95, 55%, 48%)',
      notice: 'hsl(37, 90%, 53%)',
      warning: 'hsl(22, 85%, 48%)',
      danger: 'hsl(355, 75%, 53%)',
    },
  },
};

export const blulocoLight: Theme = {
  id: 'vscode-bluloco-light',
  label: 'Bluloco Light',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 98%)', // #f9f9f9
    surfaceHighlight: 'hsl(220, 15%, 94%)',
    text: 'hsl(228, 18%, 30%)', // #383a42
    textSubtle: 'hsl(228, 10%, 48%)',
    textSubtlest: 'hsl(228, 8%, 58%)',
    primary: 'hsl(218, 80%, 48%)', // #275fe4 (blue)
    secondary: 'hsl(288, 55%, 48%)', // #a625a4 (purple)
    info: 'hsl(218, 80%, 48%)', // blue
    success: 'hsl(138, 55%, 40%)', // #23974a (green)
    notice: 'hsl(35, 85%, 45%)', // #df631c (orange)
    warning: 'hsl(22, 80%, 48%)', // #df631c (orange)
    danger: 'hsl(355, 70%, 48%)', // #d5102d (red)
  },
  components: {
    sidebar: {
      surface: 'hsl(220, 15%, 96%)',
      border: 'hsl(220, 12%, 90%)',
    },
    appHeader: {
      surface: 'hsl(220, 15%, 94%)',
      border: 'hsl(220, 12%, 88%)',
    },
  },
};

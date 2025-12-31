import type { Theme } from '@yaakapp/api';

export const blulocoDark: Theme = {
  id: 'bluloco-dark',
  label: 'Bluloco Dark',
  dark: true,
  base: {
    surface: 'hsl(230, 20%, 14%)',
    surfaceHighlight: 'hsl(230, 17%, 19%)',
    text: 'hsl(220, 15%, 80%)',
    textSubtle: 'hsl(220, 10%, 55%)',
    textSubtlest: 'hsl(220, 8%, 42%)',
    primary: 'hsl(218, 85%, 65%)',
    secondary: 'hsl(220, 10%, 55%)',
    info: 'hsl(218, 85%, 65%)',
    success: 'hsl(95, 55%, 55%)',
    notice: 'hsl(37, 90%, 60%)',
    warning: 'hsl(22, 85%, 55%)',
    danger: 'hsl(355, 75%, 60%)',
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
      secondary: 'hsl(220, 10%, 48%)',
      info: 'hsl(218, 85%, 58%)',
      success: 'hsl(95, 55%, 48%)',
      notice: 'hsl(37, 90%, 53%)',
      warning: 'hsl(22, 85%, 48%)',
      danger: 'hsl(355, 75%, 53%)',
    },
  },
};

export const blulocoLight: Theme = {
  id: 'bluloco-light',
  label: 'Bluloco Light',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 98%)',
    surfaceHighlight: 'hsl(220, 15%, 94%)',
    text: 'hsl(228, 18%, 30%)',
    textSubtle: 'hsl(228, 10%, 48%)',
    textSubtlest: 'hsl(228, 8%, 58%)',
    primary: 'hsl(218, 80%, 48%)',
    secondary: 'hsl(228, 10%, 48%)',
    info: 'hsl(218, 80%, 48%)',
    success: 'hsl(138, 55%, 40%)',
    notice: 'hsl(35, 85%, 45%)',
    warning: 'hsl(22, 80%, 48%)',
    danger: 'hsl(355, 70%, 48%)',
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

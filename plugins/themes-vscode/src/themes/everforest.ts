import type { Theme } from '@yaakapp/api';

export const everforestDark: Theme = {
  id: 'everforest-dark',
  label: 'Everforest Dark',
  dark: true,
  base: {
    surface: 'hsl(150, 8%, 18%)',
    surfaceHighlight: 'hsl(150, 7%, 22%)',
    text: 'hsl(45, 30%, 78%)',
    textSubtle: 'hsl(145, 8%, 55%)',
    textSubtlest: 'hsl(145, 6%, 42%)',
    primary: 'hsl(142, 35%, 60%)',
    secondary: 'hsl(145, 8%, 55%)',
    info: 'hsl(200, 35%, 65%)',
    success: 'hsl(142, 35%, 60%)',
    notice: 'hsl(46, 55%, 68%)',
    warning: 'hsl(24, 55%, 65%)',
    danger: 'hsl(358, 50%, 68%)',
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
      secondary: 'hsl(145, 8%, 48%)',
      info: 'hsl(200, 35%, 58%)',
      success: 'hsl(142, 35%, 53%)',
      notice: 'hsl(46, 55%, 61%)',
      warning: 'hsl(24, 55%, 58%)',
      danger: 'hsl(358, 50%, 61%)',
    },
  },
};

export const everforestLight: Theme = {
  id: 'everforest-light',
  label: 'Everforest Light',
  dark: false,
  base: {
    surface: 'hsl(40, 32%, 93%)',
    surfaceHighlight: 'hsl(40, 28%, 89%)',
    text: 'hsl(135, 8%, 35%)',
    textSubtle: 'hsl(135, 6%, 45%)',
    textSubtlest: 'hsl(135, 4%, 55%)',
    primary: 'hsl(128, 30%, 45%)',
    secondary: 'hsl(135, 6%, 45%)',
    info: 'hsl(200, 35%, 45%)',
    success: 'hsl(128, 30%, 45%)',
    notice: 'hsl(45, 70%, 40%)',
    warning: 'hsl(22, 60%, 48%)',
    danger: 'hsl(355, 55%, 50%)',
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

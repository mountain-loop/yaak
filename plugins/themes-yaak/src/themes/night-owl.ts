import type { Theme } from '@yaakapp/api';

export const nightOwl: Theme = {
  id: 'night-owl',
  label: 'Night Owl',
  dark: true,
  base: {
    surface: 'hsl(207, 95%, 8%)',
    surfaceHighlight: 'hsl(207, 50%, 14%)',
    text: 'hsl(213, 50%, 90%)',
    textSubtle: 'hsl(213, 30%, 70%)',
    textSubtlest: 'hsl(213, 20%, 50%)',
    border: 'hsl(207, 50%, 14%)',
    primary: 'hsl(261, 51%, 51%)',
    secondary: 'hsl(213, 30%, 60%)',
    info: 'hsl(220, 100%, 75%)',
    success: 'hsl(145, 100%, 43%)',
    notice: 'hsl(62, 61%, 71%)',
    warning: 'hsl(4, 90%, 58%)',
    danger: 'hsl(4, 90%, 58%)',
  },
  components: {
    dialog: {
      surface: 'hsl(207, 95%, 6%)',
    },
    sidebar: {
      surface: 'hsl(207, 95%, 8%)',
      border: 'hsl(207, 50%, 14%)',
    },
    appHeader: {
      surface: 'hsl(207, 95%, 5%)',
      border: 'hsl(207, 50%, 12%)',
    },
    responsePane: {
      surface: 'hsl(207, 70%, 10%)',
      border: 'hsl(207, 50%, 14%)',
    },
    button: {
      primary: 'hsl(261, 51%, 45%)',
      secondary: 'hsl(213, 30%, 60%)',
      info: 'hsl(220, 100%, 68%)',
      success: 'hsl(145, 100%, 38%)',
      notice: 'hsl(62, 61%, 64%)',
      warning: 'hsl(4, 90%, 52%)',
      danger: 'hsl(4, 90%, 52%)',
    },
  },
};

export const lightOwl: Theme = {
  id: 'light-owl',
  label: 'Light Owl',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 98%)',
    surfaceHighlight: 'hsl(210, 18%, 94%)',
    text: 'hsl(224, 26%, 27%)',
    textSubtle: 'hsl(224, 15%, 45%)',
    textSubtlest: 'hsl(224, 10%, 55%)',
    primary: 'hsl(283, 100%, 41%)',
    secondary: 'hsl(224, 15%, 50%)',
    info: 'hsl(219, 75%, 40%)',
    success: 'hsl(145, 70%, 35%)',
    notice: 'hsl(36, 95%, 40%)',
    warning: 'hsl(0, 55%, 55%)',
    danger: 'hsl(0, 55%, 50%)',
  },
  components: {
    sidebar: {
      surface: 'hsl(210, 20%, 96%)',
      border: 'hsl(210, 15%, 90%)',
    },
    appHeader: {
      surface: 'hsl(210, 20%, 94%)',
      border: 'hsl(210, 15%, 88%)',
    },
  },
};

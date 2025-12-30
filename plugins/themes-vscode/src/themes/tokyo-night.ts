import type { Theme } from '@yaakapp/api';

export const tokyoNight: Theme = {
  id: 'vscode-tokyo-night',
  label: 'Tokyo Night',
  dark: true,
  base: {
    surface: 'hsl(235, 21%, 13%)', // #1a1b26
    surfaceHighlight: 'hsl(235, 18%, 18%)',
    text: 'hsl(229, 28%, 76%)', // #a9b1d6
    textSubtle: 'hsl(232, 18%, 52%)', // #565f89
    textSubtlest: 'hsl(234, 16%, 40%)',
    primary: 'hsl(266, 100%, 78%)', // #bb9af7 (purple)
    secondary: 'hsl(232, 18%, 52%)',
    info: 'hsl(217, 100%, 73%)', // #7aa2f7 (blue)
    success: 'hsl(158, 57%, 63%)', // #73daca (teal)
    notice: 'hsl(40, 67%, 65%)', // #e0af68 (yellow)
    warning: 'hsl(25, 75%, 58%)', // #ff9e64 (orange)
    danger: 'hsl(358, 100%, 70%)', // #f7768e (red)
  },
  components: {
    dialog: {
      surface: 'hsl(235, 21%, 11%)',
    },
    sidebar: {
      surface: 'hsl(235, 21%, 11%)',
      border: 'hsl(235, 18%, 16%)',
    },
    appHeader: {
      surface: 'hsl(235, 21%, 9%)',
      border: 'hsl(235, 18%, 14%)',
    },
    responsePane: {
      surface: 'hsl(235, 21%, 11%)',
      border: 'hsl(235, 18%, 16%)',
    },
    button: {
      primary: 'hsl(266, 100%, 71%)',
      info: 'hsl(217, 100%, 66%)',
      success: 'hsl(158, 57%, 56%)',
      notice: 'hsl(40, 67%, 58%)',
      warning: 'hsl(25, 75%, 52%)',
      danger: 'hsl(358, 100%, 63%)',
    },
  },
};

export const tokyoNightStorm: Theme = {
  id: 'vscode-tokyo-night-storm',
  label: 'Tokyo Night Storm',
  dark: true,
  base: {
    surface: 'hsl(232, 25%, 17%)', // #24283b
    surfaceHighlight: 'hsl(232, 22%, 22%)',
    text: 'hsl(229, 28%, 76%)', // #a9b1d6
    textSubtle: 'hsl(232, 18%, 52%)',
    textSubtlest: 'hsl(234, 16%, 40%)',
    primary: 'hsl(266, 100%, 78%)', // #bb9af7
    secondary: 'hsl(232, 18%, 52%)',
    info: 'hsl(217, 100%, 73%)', // #7aa2f7
    success: 'hsl(158, 57%, 63%)', // #73daca
    notice: 'hsl(40, 67%, 65%)', // #e0af68
    warning: 'hsl(25, 75%, 58%)', // #ff9e64
    danger: 'hsl(358, 100%, 70%)', // #f7768e
  },
  components: {
    dialog: {
      surface: 'hsl(232, 25%, 14%)',
    },
    sidebar: {
      surface: 'hsl(232, 25%, 14%)',
      border: 'hsl(232, 22%, 20%)',
    },
    appHeader: {
      surface: 'hsl(232, 25%, 12%)',
      border: 'hsl(232, 22%, 18%)',
    },
    responsePane: {
      surface: 'hsl(232, 25%, 14%)',
      border: 'hsl(232, 22%, 20%)',
    },
    button: {
      primary: 'hsl(266, 100%, 71%)',
      info: 'hsl(217, 100%, 66%)',
      success: 'hsl(158, 57%, 56%)',
      notice: 'hsl(40, 67%, 58%)',
      warning: 'hsl(25, 75%, 52%)',
      danger: 'hsl(358, 100%, 63%)',
    },
  },
};

export const tokyoNightDay: Theme = {
  id: 'vscode-tokyo-night-day',
  label: 'Tokyo Night Day',
  dark: false,
  base: {
    surface: 'hsl(212, 100%, 98%)', // #e1e2e7
    surfaceHighlight: 'hsl(212, 60%, 93%)',
    text: 'hsl(233, 26%, 27%)', // #3760bf
    textSubtle: 'hsl(232, 18%, 45%)',
    textSubtlest: 'hsl(232, 12%, 55%)',
    primary: 'hsl(290, 80%, 45%)', // #9854f1 purple
    secondary: 'hsl(232, 18%, 50%)',
    info: 'hsl(217, 88%, 52%)', // #2e7de9 blue
    success: 'hsl(160, 75%, 35%)', // #587539 or teal
    notice: 'hsl(41, 80%, 40%)', // #8c6c3e
    warning: 'hsl(20, 80%, 48%)', // #b15c00
    danger: 'hsl(359, 65%, 48%)', // #f52a65
  },
  components: {
    sidebar: {
      surface: 'hsl(212, 60%, 95%)',
      border: 'hsl(212, 40%, 88%)',
    },
    appHeader: {
      surface: 'hsl(212, 60%, 93%)',
      border: 'hsl(212, 40%, 86%)',
    },
  },
};

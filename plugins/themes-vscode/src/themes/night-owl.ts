import type { Theme } from '@yaakapp/api';

export const nightOwl: Theme = {
  id: 'vscode-night-owl',
  label: 'Night Owl',
  dark: true,
  base: {
    surface: 'hsl(207, 95%, 8%)', // #011627
    surfaceHighlight: 'hsl(207, 50%, 14%)',
    text: 'hsl(213, 50%, 90%)', // #d6deeb
    textSubtle: 'hsl(213, 30%, 70%)',
    textSubtlest: 'hsl(213, 20%, 50%)',
    primary: 'hsl(261, 51%, 51%)', // #7e57c2 (cursor purple)
    secondary: 'hsl(213, 30%, 60%)',
    info: 'hsl(220, 100%, 75%)', // #82aaff
    success: 'hsl(145, 100%, 43%)', // #22da6e
    notice: 'hsl(62, 61%, 71%)', // #addb67 (yellow)
    warning: 'hsl(4, 90%, 58%)', // #ef5350
    danger: 'hsl(4, 90%, 58%)', // #ef5350
  },
  components: {
    dialog: {
      surface: 'hsl(207, 95%, 6%)',
    },
    sidebar: {
      surface: 'hsl(207, 70%, 10%)',
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
      info: 'hsl(220, 100%, 68%)',
      success: 'hsl(145, 100%, 38%)',
      notice: 'hsl(62, 61%, 64%)',
      warning: 'hsl(4, 90%, 52%)',
      danger: 'hsl(4, 90%, 52%)',
    },
  },
};

export const lightOwl: Theme = {
  id: 'vscode-light-owl',
  label: 'Light Owl',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 98%)', // #FBFBFB
    surfaceHighlight: 'hsl(210, 18%, 94%)',
    text: 'hsl(224, 26%, 27%)', // #403f53
    textSubtle: 'hsl(224, 15%, 45%)',
    textSubtlest: 'hsl(224, 10%, 55%)',
    primary: 'hsl(283, 100%, 41%)', // #994cc3
    secondary: 'hsl(224, 15%, 50%)',
    info: 'hsl(219, 75%, 40%)', // #4876d6
    success: 'hsl(145, 70%, 35%)',
    notice: 'hsl(36, 95%, 40%)', // #c96765
    warning: 'hsl(0, 55%, 55%)', // #bc5454
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

import type { Theme } from '@yaakapp/api';

export const ayuDark: Theme = {
  id: 'vscode-ayu-dark',
  label: 'Ayu Dark',
  dark: true,
  base: {
    surface: 'hsl(220, 25%, 10%)', // #0a0e14
    surfaceHighlight: 'hsl(220, 20%, 15%)',
    text: 'hsl(210, 22%, 78%)', // #b3b1ad
    textSubtle: 'hsl(40, 13%, 50%)', // #6c6055
    textSubtlest: 'hsl(220, 10%, 40%)',
    primary: 'hsl(38, 100%, 56%)', // #ffb454 (orange accent)
    secondary: 'hsl(210, 15%, 55%)',
    info: 'hsl(200, 80%, 60%)', // #59c2ff (blue)
    success: 'hsl(100, 75%, 60%)', // #aad94c (green)
    notice: 'hsl(38, 100%, 56%)', // #ffb454 (yellow/orange)
    warning: 'hsl(25, 100%, 60%)', // #ff8f40 (orange)
    danger: 'hsl(345, 80%, 60%)', // #f07178 (red)
  },
  components: {
    dialog: {
      surface: 'hsl(220, 25%, 8%)',
    },
    sidebar: {
      surface: 'hsl(220, 22%, 12%)',
      border: 'hsl(220, 20%, 16%)',
    },
    appHeader: {
      surface: 'hsl(220, 25%, 7%)',
      border: 'hsl(220, 20%, 13%)',
    },
    responsePane: {
      surface: 'hsl(220, 22%, 12%)',
      border: 'hsl(220, 20%, 16%)',
    },
    button: {
      primary: 'hsl(38, 100%, 50%)',
      info: 'hsl(200, 80%, 53%)',
      success: 'hsl(100, 75%, 53%)',
      notice: 'hsl(38, 100%, 50%)',
      warning: 'hsl(25, 100%, 53%)',
      danger: 'hsl(345, 80%, 53%)',
    },
  },
};

export const ayuMirage: Theme = {
  id: 'vscode-ayu-mirage',
  label: 'Ayu Mirage',
  dark: true,
  base: {
    surface: 'hsl(226, 23%, 17%)', // #1f2430
    surfaceHighlight: 'hsl(226, 20%, 22%)',
    text: 'hsl(212, 15%, 81%)', // #cbccc6
    textSubtle: 'hsl(212, 12%, 55%)', // #707a8c
    textSubtlest: 'hsl(212, 10%, 45%)',
    primary: 'hsl(38, 100%, 67%)', // #ffcc66 (accent)
    secondary: 'hsl(212, 12%, 55%)',
    info: 'hsl(200, 80%, 70%)', // #73d0ff (blue)
    success: 'hsl(100, 50%, 68%)', // #bae67e (green)
    notice: 'hsl(38, 100%, 67%)', // #ffcc66 (yellow)
    warning: 'hsl(25, 100%, 70%)', // #ffa759 (orange)
    danger: 'hsl(345, 80%, 70%)', // #f28779 (red)
  },
  components: {
    dialog: {
      surface: 'hsl(226, 23%, 14%)',
    },
    sidebar: {
      surface: 'hsl(226, 22%, 15%)',
      border: 'hsl(226, 20%, 20%)',
    },
    appHeader: {
      surface: 'hsl(226, 23%, 12%)',
      border: 'hsl(226, 20%, 17%)',
    },
    responsePane: {
      surface: 'hsl(226, 22%, 15%)',
      border: 'hsl(226, 20%, 20%)',
    },
    button: {
      primary: 'hsl(38, 100%, 60%)',
      info: 'hsl(200, 80%, 63%)',
      success: 'hsl(100, 50%, 61%)',
      notice: 'hsl(38, 100%, 60%)',
      warning: 'hsl(25, 100%, 63%)',
      danger: 'hsl(345, 80%, 63%)',
    },
  },
};

export const ayuLight: Theme = {
  id: 'vscode-ayu-light',
  label: 'Ayu Light',
  dark: false,
  base: {
    surface: 'hsl(40, 22%, 97%)', // #fafafa
    surfaceHighlight: 'hsl(40, 20%, 93%)',
    text: 'hsl(214, 10%, 35%)', // #575f66
    textSubtle: 'hsl(214, 8%, 50%)', // #828c99
    textSubtlest: 'hsl(214, 6%, 60%)',
    primary: 'hsl(35, 100%, 45%)', // #f29718 (accent)
    secondary: 'hsl(214, 8%, 50%)',
    info: 'hsl(200, 75%, 45%)', // #399ee6 (blue)
    success: 'hsl(100, 60%, 40%)', // #86b300 (green)
    notice: 'hsl(35, 100%, 45%)', // #f29718 (yellow)
    warning: 'hsl(22, 100%, 50%)', // #fa8d3e (orange)
    danger: 'hsl(345, 70%, 55%)', // #f07171 (red)
  },
  components: {
    sidebar: {
      surface: 'hsl(40, 20%, 95%)',
      border: 'hsl(40, 15%, 90%)',
    },
    appHeader: {
      surface: 'hsl(40, 20%, 93%)',
      border: 'hsl(40, 15%, 88%)',
    },
  },
};

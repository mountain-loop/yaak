import type { Theme } from '@yaakapp/api';

export const ayuDark: Theme = {
  id: 'ayu-dark',
  label: 'Ayu Dark',
  dark: true,
  base: {
    surface: 'hsl(220, 25%, 10%)',
    surfaceHighlight: 'hsl(220, 20%, 15%)',
    text: 'hsl(210, 22%, 78%)',
    textSubtle: 'hsl(40, 13%, 50%)',
    textSubtlest: 'hsl(220, 10%, 40%)',
    primary: 'hsl(38, 100%, 56%)',
    secondary: 'hsl(210, 15%, 55%)',
    info: 'hsl(200, 80%, 60%)',
    success: 'hsl(100, 75%, 60%)',
    notice: 'hsl(38, 100%, 56%)',
    warning: 'hsl(25, 100%, 60%)',
    danger: 'hsl(345, 80%, 60%)',
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
      secondary: 'hsl(210, 15%, 48%)',
      info: 'hsl(200, 80%, 53%)',
      success: 'hsl(100, 75%, 53%)',
      notice: 'hsl(38, 100%, 50%)',
      warning: 'hsl(25, 100%, 53%)',
      danger: 'hsl(345, 80%, 53%)',
    },
  },
};

export const ayuMirage: Theme = {
  id: 'ayu-mirage',
  label: 'Ayu Mirage',
  dark: true,
  base: {
    surface: 'hsl(226, 23%, 17%)',
    surfaceHighlight: 'hsl(226, 20%, 22%)',
    text: 'hsl(212, 15%, 81%)',
    textSubtle: 'hsl(212, 12%, 55%)',
    textSubtlest: 'hsl(212, 10%, 45%)',
    primary: 'hsl(38, 100%, 67%)',
    secondary: 'hsl(212, 12%, 55%)',
    info: 'hsl(200, 80%, 70%)',
    success: 'hsl(100, 50%, 68%)',
    notice: 'hsl(38, 100%, 67%)',
    warning: 'hsl(25, 100%, 70%)',
    danger: 'hsl(345, 80%, 70%)',
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
  id: 'ayu-light',
  label: 'Ayu Light',
  dark: false,
  base: {
    surface: 'hsl(40, 22%, 97%)',
    surfaceHighlight: 'hsl(40, 20%, 93%)',
    text: 'hsl(214, 10%, 35%)',
    textSubtle: 'hsl(214, 8%, 50%)',
    textSubtlest: 'hsl(214, 6%, 60%)',
    primary: 'hsl(35, 100%, 45%)',
    secondary: 'hsl(214, 8%, 50%)',
    info: 'hsl(200, 75%, 45%)',
    success: 'hsl(100, 60%, 40%)',
    notice: 'hsl(35, 100%, 45%)',
    warning: 'hsl(22, 100%, 50%)',
    danger: 'hsl(345, 70%, 55%)',
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

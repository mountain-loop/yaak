import type { Theme } from '@yaakapp/api';

export const vitesseDark: Theme = {
  id: 'vitesse-dark',
  label: 'Vitesse Dark',
  dark: true,
  base: {
    surface: 'hsl(220, 13%, 10%)',
    surfaceHighlight: 'hsl(220, 12%, 15%)',
    text: 'hsl(220, 10%, 80%)',
    textSubtle: 'hsl(220, 8%, 55%)',
    textSubtlest: 'hsl(220, 6%, 42%)',
    primary: 'hsl(143, 50%, 55%)',
    secondary: 'hsl(220, 8%, 55%)',
    info: 'hsl(214, 60%, 65%)',
    success: 'hsl(143, 50%, 55%)',
    notice: 'hsl(45, 65%, 65%)',
    warning: 'hsl(30, 60%, 60%)',
    danger: 'hsl(355, 60%, 60%)',
  },
  components: {
    dialog: {
      surface: 'hsl(220, 13%, 7%)',
    },
    sidebar: {
      surface: 'hsl(220, 12%, 8%)',
      border: 'hsl(220, 10%, 14%)',
    },
    appHeader: {
      surface: 'hsl(220, 13%, 6%)',
      border: 'hsl(220, 10%, 12%)',
    },
    responsePane: {
      surface: 'hsl(220, 12%, 8%)',
      border: 'hsl(220, 10%, 14%)',
    },
    button: {
      primary: 'hsl(143, 50%, 48%)',
      secondary: 'hsl(220, 8%, 48%)',
      info: 'hsl(214, 60%, 58%)',
      success: 'hsl(143, 50%, 48%)',
      notice: 'hsl(45, 65%, 58%)',
      warning: 'hsl(30, 60%, 53%)',
      danger: 'hsl(355, 60%, 53%)',
    },
  },
};

export const vitesseLight: Theme = {
  id: 'vitesse-light',
  label: 'Vitesse Light',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 100%)',
    surfaceHighlight: 'hsl(40, 20%, 96%)',
    text: 'hsl(0, 0%, 24%)',
    textSubtle: 'hsl(0, 0%, 45%)',
    textSubtlest: 'hsl(0, 0%, 55%)',
    primary: 'hsl(143, 40%, 40%)',
    secondary: 'hsl(0, 0%, 45%)',
    info: 'hsl(214, 50%, 48%)',
    success: 'hsl(143, 40%, 40%)',
    notice: 'hsl(40, 60%, 42%)',
    warning: 'hsl(25, 60%, 48%)',
    danger: 'hsl(345, 50%, 48%)',
  },
  components: {
    sidebar: {
      surface: 'hsl(40, 20%, 97%)',
      border: 'hsl(40, 15%, 92%)',
    },
    appHeader: {
      surface: 'hsl(40, 20%, 95%)',
      border: 'hsl(40, 15%, 90%)',
    },
  },
};

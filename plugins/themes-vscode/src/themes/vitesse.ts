import type { Theme } from '@yaakapp/api';

export const vitesseDark: Theme = {
  id: 'vscode-vitesse-dark',
  label: 'Vitesse Dark',
  dark: true,
  base: {
    surface: 'hsl(220, 13%, 10%)', // #121212
    surfaceHighlight: 'hsl(220, 12%, 15%)',
    text: 'hsl(220, 10%, 80%)', // #dbd7caee
    textSubtle: 'hsl(220, 8%, 55%)',
    textSubtlest: 'hsl(220, 6%, 42%)',
    primary: 'hsl(143, 50%, 55%)', // #4d9375 (green/teal)
    secondary: 'hsl(30, 60%, 60%)', // #cb7676 (salmon)
    info: 'hsl(214, 60%, 65%)', // #6394bf (blue)
    success: 'hsl(143, 50%, 55%)', // #4d9375 (green)
    notice: 'hsl(45, 65%, 65%)', // #e6cc77 (yellow)
    warning: 'hsl(30, 60%, 60%)', // #cb7676 (orange/salmon)
    danger: 'hsl(355, 60%, 60%)', // #cb7676 (red)
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
      secondary: 'hsl(30, 60%, 53%)',
      info: 'hsl(214, 60%, 58%)',
      success: 'hsl(143, 50%, 48%)',
      notice: 'hsl(45, 65%, 58%)',
      warning: 'hsl(30, 60%, 53%)',
      danger: 'hsl(355, 60%, 53%)',
    },
  },
};

export const vitesseLight: Theme = {
  id: 'vscode-vitesse-light',
  label: 'Vitesse Light',
  dark: false,
  base: {
    surface: 'hsl(0, 0%, 100%)', // #ffffff
    surfaceHighlight: 'hsl(40, 20%, 96%)',
    text: 'hsl(0, 0%, 24%)', // #393a34
    textSubtle: 'hsl(0, 0%, 45%)',
    textSubtlest: 'hsl(0, 0%, 55%)',
    primary: 'hsl(143, 40%, 40%)', // #1e754f (green)
    secondary: 'hsl(345, 50%, 48%)', // #ab5959 (rose)
    info: 'hsl(214, 50%, 48%)', // #296aa3 (blue)
    success: 'hsl(143, 40%, 40%)', // #1e754f (green)
    notice: 'hsl(40, 60%, 42%)', // #bda437 (yellow)
    warning: 'hsl(25, 60%, 48%)', // #a65e2b (orange)
    danger: 'hsl(345, 50%, 48%)', // #ab5959 (red/rose)
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

import type { Theme } from '@yaakapp/api';

export const githubDarkDimmed: Theme = {
  id: 'github-dark-dimmed',
  label: 'GitHub Dark Dimmed',
  dark: true,
  base: {
    surface: 'hsl(215, 15%, 16%)',
    surfaceHighlight: 'hsl(215, 13%, 20%)',
    text: 'hsl(212, 15%, 78%)',
    textSubtle: 'hsl(212, 10%, 55%)',
    textSubtlest: 'hsl(212, 8%, 42%)',
    primary: 'hsl(212, 80%, 65%)',
    secondary: 'hsl(212, 10%, 55%)',
    info: 'hsl(212, 80%, 65%)',
    success: 'hsl(140, 50%, 50%)',
    notice: 'hsl(42, 75%, 55%)',
    warning: 'hsl(27, 80%, 55%)',
    danger: 'hsl(355, 70%, 55%)',
  },
  components: {
    dialog: {
      surface: 'hsl(215, 15%, 13%)',
    },
    sidebar: {
      surface: 'hsl(215, 14%, 14%)',
      border: 'hsl(215, 12%, 19%)',
    },
    appHeader: {
      surface: 'hsl(215, 15%, 12%)',
      border: 'hsl(215, 12%, 17%)',
    },
    responsePane: {
      surface: 'hsl(215, 14%, 14%)',
      border: 'hsl(215, 12%, 19%)',
    },
    button: {
      primary: 'hsl(212, 80%, 58%)',
      info: 'hsl(212, 80%, 58%)',
      success: 'hsl(140, 50%, 45%)',
      notice: 'hsl(42, 75%, 48%)',
      warning: 'hsl(27, 80%, 48%)',
      danger: 'hsl(355, 70%, 48%)',
    },
  },
};

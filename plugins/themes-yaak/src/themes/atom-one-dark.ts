import type { Theme } from '@yaakapp/api';

export const atomOneDark: Theme = {
  id: 'atom-one-dark',
  label: 'Atom One Dark',
  dark: true,
  base: {
    surface: 'hsl(220, 13%, 18%)',
    surfaceHighlight: 'hsl(219, 13%, 22%)',
    text: 'hsl(219, 14%, 71%)',
    textSubtle: 'hsl(220, 9%, 55%)',
    textSubtlest: 'hsl(220, 8%, 45%)',
    primary: 'hsl(286, 60%, 67%)',
    secondary: 'hsl(220, 9%, 55%)',
    info: 'hsl(207, 82%, 66%)',
    success: 'hsl(95, 38%, 62%)',
    notice: 'hsl(39, 67%, 69%)',
    warning: 'hsl(29, 54%, 61%)',
    danger: 'hsl(355, 65%, 65%)',
  },
  components: {
    dialog: {
      surface: 'hsl(220, 13%, 14%)',
    },
    sidebar: {
      surface: 'hsl(220, 13%, 16%)',
      border: 'hsl(220, 13%, 20%)',
    },
    appHeader: {
      surface: 'hsl(220, 13%, 12%)',
      border: 'hsl(220, 13%, 18%)',
    },
    responsePane: {
      surface: 'hsl(220, 13%, 16%)',
      border: 'hsl(220, 13%, 20%)',
    },
    button: {
      primary: 'hsl(286, 60%, 60%)',
      secondary: 'hsl(220, 9%, 48%)',
      info: 'hsl(207, 82%, 59%)',
      success: 'hsl(95, 38%, 55%)',
      notice: 'hsl(39, 67%, 62%)',
      warning: 'hsl(29, 54%, 54%)',
      danger: 'hsl(355, 65%, 58%)',
    },
  },
};

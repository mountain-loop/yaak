import type { Theme } from '@yaakapp/api';

export const githubDarkDimmed: Theme = {
  id: 'vscode-github-dark-dimmed',
  label: 'GitHub Dark Dimmed',
  dark: true,
  base: {
    surface: 'hsl(215, 15%, 16%)', // #22272e
    surfaceHighlight: 'hsl(215, 13%, 20%)',
    text: 'hsl(212, 15%, 78%)', // #adbac7
    textSubtle: 'hsl(212, 10%, 55%)', // #768390
    textSubtlest: 'hsl(212, 8%, 42%)',
    primary: 'hsl(212, 80%, 65%)', // #539bf5 (blue)
    secondary: 'hsl(212, 10%, 55%)',
    info: 'hsl(212, 80%, 65%)', // #539bf5 (blue)
    success: 'hsl(140, 50%, 50%)', // #57ab5a (green)
    notice: 'hsl(42, 75%, 55%)', // #c69026 (yellow)
    warning: 'hsl(27, 80%, 55%)', // #e5534b (orange)
    danger: 'hsl(355, 70%, 55%)', // #e5534b (red)
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

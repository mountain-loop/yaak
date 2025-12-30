import type { Theme } from '@yaakapp/api';

export const oneDarkPro: Theme = {
  id: 'vscode-one-dark-pro',
  label: 'One Dark Pro',
  dark: true,
  base: {
    surface: 'hsl(220, 13%, 18%)', // #282c34
    surfaceHighlight: 'hsl(220, 13%, 22%)',
    text: 'hsl(219, 14%, 71%)', // #abb2bf
    textSubtle: 'hsl(219, 10%, 53%)',
    textSubtlest: 'hsl(220, 9%, 45%)',
    primary: 'hsl(286, 60%, 67%)', // #c678dd (purple)
    secondary: 'hsl(219, 14%, 60%)',
    info: 'hsl(207, 82%, 66%)', // #61afef (blue)
    success: 'hsl(95, 38%, 62%)', // #98c379 (green)
    notice: 'hsl(39, 67%, 69%)', // #e5c07b (yellow)
    warning: 'hsl(29, 54%, 61%)', // #d19a66 (orange)
    danger: 'hsl(355, 65%, 65%)', // #e06c75 (red)
  },
  components: {
    sidebar: {
      surface: 'hsl(220, 13%, 16%)',
      border: 'hsl(220, 13%, 20%)',
    },
    appHeader: {
      surface: 'hsl(220, 13%, 14%)',
      border: 'hsl(220, 13%, 20%)',
    },
    responsePane: {
      surface: 'hsl(220, 13%, 16%)',
      border: 'hsl(220, 13%, 20%)',
    },
    button: {
      primary: 'hsl(286, 60%, 60%)',
      secondary: 'hsl(219, 14%, 53%)',
      info: 'hsl(207, 82%, 59%)',
      success: 'hsl(95, 38%, 55%)',
      notice: 'hsl(39, 67%, 62%)',
      warning: 'hsl(29, 54%, 54%)',
      danger: 'hsl(355, 65%, 58%)',
    },
  },
};

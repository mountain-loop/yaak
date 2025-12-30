import type { Theme } from '@yaakapp/api';

export const cobalt2: Theme = {
  id: 'vscode-cobalt2',
  label: 'Cobalt2',
  dark: true,
  base: {
    surface: 'hsl(200, 50%, 19%)', // #193549
    surfaceHighlight: 'hsl(200, 43%, 25%)', // #1F4662
    text: 'hsl(0, 0%, 100%)', // #fff
    textSubtle: 'hsl(0, 0%, 67%)', // #aaa
    textSubtlest: 'hsl(0, 0%, 50%)',
    primary: 'hsl(50, 100%, 50%)', // #ffc600 (yellow)
    secondary: 'hsl(180, 100%, 57%)', // #2AFFDF (mint)
    info: 'hsl(180, 100%, 80%)', // #9EFFFF (light blue)
    success: 'hsl(180, 100%, 57%)', // #2AFFDF (mint)
    notice: 'hsl(50, 100%, 50%)', // #ffc600 (yellow)
    warning: 'hsl(33, 100%, 50%)', // #ff9d00 (orange)
    danger: 'hsl(330, 100%, 50%)', // #ff0088 (hot pink)
  },
  components: {
    dialog: {
      surface: 'hsl(200, 55%, 14%)', // #15232D
    },
    sidebar: {
      surface: 'hsl(200, 53%, 16%)', // #122738
      border: 'hsl(200, 55%, 12%)',
    },
    appHeader: {
      surface: 'hsl(200, 53%, 16%)',
      border: 'hsl(200, 55%, 12%)',
    },
    responsePane: {
      surface: 'hsl(200, 50%, 17%)',
      border: 'hsl(200, 45%, 21%)',
    },
    button: {
      primary: 'hsl(50, 100%, 45%)',
      secondary: 'hsl(180, 100%, 50%)',
      info: 'hsl(180, 100%, 73%)',
      success: 'hsl(180, 100%, 50%)',
      notice: 'hsl(50, 100%, 45%)',
      warning: 'hsl(33, 100%, 45%)',
      danger: 'hsl(330, 100%, 45%)',
    },
  },
};

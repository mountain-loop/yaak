import type { Theme } from '@yaakapp/api';

export const shadesOfPurple: Theme = {
  id: 'vscode-shades-of-purple',
  label: 'Shades of Purple',
  dark: true,
  base: {
    surface: 'hsl(248, 32%, 25%)', // #2D2B55
    surfaceHighlight: 'hsl(247, 42%, 18%)', // #1E1E3F
    text: 'hsl(255, 100%, 100%)', // #FFFFFF
    textSubtle: 'hsl(255, 50%, 77%)', // #A599E9
    textSubtlest: 'hsl(255, 30%, 55%)',
    primary: 'hsl(50, 100%, 50%)', // #FAD000 (yellow accent)
    secondary: 'hsl(284, 100%, 80%)', // #B362FF (purple)
    info: 'hsl(176, 100%, 80%)', // #9EFFFF (cyan)
    success: 'hsl(99, 100%, 78%)', // #A5FF90 (green)
    notice: 'hsl(50, 100%, 75%)', // #FFEE80 (light yellow)
    warning: 'hsl(33, 100%, 50%)', // #FF9D00 (orange)
    danger: 'hsl(345, 95%, 55%)', // #FF628C (pink-red)
  },
  components: {
    dialog: {
      surface: 'hsl(247, 42%, 15%)',
    },
    sidebar: {
      surface: 'hsl(247, 42%, 18%)',
      border: 'hsl(247, 35%, 25%)',
    },
    appHeader: {
      surface: 'hsl(247, 42%, 14%)',
      border: 'hsl(247, 35%, 22%)',
    },
    responsePane: {
      surface: 'hsl(247, 42%, 18%)',
      border: 'hsl(247, 35%, 25%)',
    },
    button: {
      primary: 'hsl(50, 100%, 45%)',
      secondary: 'hsl(284, 100%, 73%)',
      info: 'hsl(176, 100%, 73%)',
      success: 'hsl(99, 100%, 71%)',
      notice: 'hsl(50, 100%, 68%)',
      warning: 'hsl(33, 100%, 45%)',
      danger: 'hsl(345, 95%, 50%)',
    },
  },
};

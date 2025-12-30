import type { Theme } from '@yaakapp/api';

export const synthwave84: Theme = {
  id: 'vscode-synthwave-84',
  label: "SynthWave '84",
  dark: true,
  base: {
    surface: 'hsl(253, 45%, 15%)', // #262335
    surfaceHighlight: 'hsl(253, 40%, 20%)',
    text: 'hsl(300, 50%, 90%)', // #f4eee4 warm white
    textSubtle: 'hsl(280, 25%, 65%)',
    textSubtlest: 'hsl(280, 20%, 50%)',
    primary: 'hsl(177, 100%, 55%)', // #36f9f6 (cyan)
    secondary: 'hsl(320, 70%, 70%)', // #ff7edb (pink)
    info: 'hsl(320, 100%, 75%)', // #ff7edb (bright pink)
    success: 'hsl(83, 100%, 60%)', // #72f1b8 (green)
    notice: 'hsl(57, 100%, 60%)', // #fede5d (yellow)
    warning: 'hsl(30, 100%, 60%)', // #f97e72 (orange)
    danger: 'hsl(340, 100%, 65%)', // #fe4450 (red)
  },
  components: {
    dialog: {
      surface: 'hsl(253, 45%, 12%)',
    },
    sidebar: {
      surface: 'hsl(253, 42%, 18%)',
      border: 'hsl(253, 40%, 22%)',
    },
    appHeader: {
      surface: 'hsl(253, 45%, 11%)',
      border: 'hsl(253, 40%, 18%)',
    },
    responsePane: {
      surface: 'hsl(253, 42%, 18%)',
      border: 'hsl(253, 40%, 22%)',
    },
    button: {
      primary: 'hsl(177, 100%, 48%)',
      secondary: 'hsl(320, 70%, 63%)',
      info: 'hsl(320, 100%, 68%)',
      success: 'hsl(83, 100%, 53%)',
      notice: 'hsl(57, 100%, 53%)',
      warning: 'hsl(30, 100%, 53%)',
      danger: 'hsl(340, 100%, 58%)',
    },
    editor: {
      primary: 'hsl(177, 100%, 55%)',
      secondary: 'hsl(320, 70%, 70%)',
      info: 'hsl(320, 100%, 75%)',
      success: 'hsl(83, 100%, 60%)',
      notice: 'hsl(57, 100%, 60%)',
      warning: 'hsl(30, 100%, 60%)',
      danger: 'hsl(340, 100%, 65%)',
    },
  },
};

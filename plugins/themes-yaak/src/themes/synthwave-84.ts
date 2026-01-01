import type { Theme } from '@yaakapp/api';

export const synthwave84: Theme = {
  id: 'synthwave-84',
  label: "SynthWave '84",
  dark: true,
  base: {
    surface: 'hsl(253, 45%, 15%)',
    surfaceHighlight: 'hsl(253, 40%, 20%)',
    text: 'hsl(300, 50%, 90%)',
    textSubtle: 'hsl(280, 25%, 65%)',
    textSubtlest: 'hsl(280, 20%, 50%)',
    primary: 'hsl(320, 100%, 75%)',
    secondary: 'hsl(280, 20%, 60%)',
    info: 'hsl(177, 100%, 55%)',
    success: 'hsl(83, 100%, 60%)',
    notice: 'hsl(57, 100%, 60%)',
    warning: 'hsl(30, 100%, 60%)',
    danger: 'hsl(340, 100%, 65%)',
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
      primary: 'hsl(320, 100%, 68%)',
      secondary: 'hsl(280, 20%, 53%)',
      info: 'hsl(177, 100%, 48%)',
      success: 'hsl(83, 100%, 53%)',
      notice: 'hsl(57, 100%, 53%)',
      warning: 'hsl(30, 100%, 53%)',
      danger: 'hsl(340, 100%, 58%)',
    },
    editor: {
      primary: 'hsl(177, 100%, 55%)',
      secondary: 'hsl(280, 20%, 60%)',
      info: 'hsl(320, 100%, 75%)',
      success: 'hsl(83, 100%, 60%)',
      notice: 'hsl(57, 100%, 60%)',
      warning: 'hsl(30, 100%, 60%)',
      danger: 'hsl(340, 100%, 65%)',
    },
  },
};

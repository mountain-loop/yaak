import type { Theme } from '@yaakapp/api';

export const materialPalenight: Theme = {
  id: 'vscode-material-palenight',
  label: 'Material Palenight',
  dark: true,
  base: {
    surface: 'hsl(234, 23%, 21%)', // #292D3E
    surfaceHighlight: 'hsl(233, 18%, 27%)',
    text: 'hsl(229, 27%, 73%)', // #A6ACCD
    textSubtle: 'hsl(232, 14%, 51%)', // #676E95
    textSubtlest: 'hsl(232, 18%, 40%)',
    primary: 'hsl(291, 47%, 51%)', // #ab47bc (accent)
    secondary: 'hsl(232, 14%, 51%)',
    info: 'hsl(224, 100%, 75%)', // #82aaff (blue)
    success: 'hsl(84, 60%, 73%)', // #c3e88d (green)
    notice: 'hsl(43, 100%, 70%)', // #ffcb6b (yellow)
    warning: 'hsl(14, 85%, 70%)', // #f78c6c (orange)
    danger: 'hsl(1, 77%, 59%)', // #ff5370 (error)
  },
  components: {
    dialog: {
      surface: 'hsl(234, 23%, 14%)', // #202331 (contrast)
    },
    sidebar: {
      surface: 'hsl(236, 16%, 26%)', // #34324a
      border: 'hsl(237, 19%, 21%)', // #2b2a3e
    },
    appHeader: {
      surface: 'hsl(237, 23%, 16%)',
      border: 'hsl(237, 19%, 21%)',
    },
    responsePane: {
      surface: 'hsl(236, 16%, 26%)',
      border: 'hsl(237, 19%, 21%)',
    },
    button: {
      primary: 'hsl(291, 47%, 45%)',
      secondary: 'hsl(232, 14%, 45%)',
      info: 'hsl(224, 100%, 68%)',
      success: 'hsl(84, 60%, 66%)',
      notice: 'hsl(43, 100%, 63%)',
      warning: 'hsl(14, 85%, 63%)',
      danger: 'hsl(1, 77%, 52%)',
    },
  },
};

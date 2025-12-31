import type { Theme } from '@yaakapp/api';

export const slackAubergine: Theme = {
  id: 'slack-aubergine',
  label: 'Slack Aubergine',
  dark: true,
  base: {
    surface: 'hsl(270, 25%, 18%)',
    surfaceHighlight: 'hsl(270, 22%, 24%)',
    text: 'hsl(0, 0%, 100%)',
    textSubtle: 'hsl(270, 15%, 75%)',
    textSubtlest: 'hsl(270, 12%, 58%)',
    primary: 'hsl(165, 100%, 40%)',
    secondary: 'hsl(270, 12%, 65%)',
    info: 'hsl(195, 95%, 55%)',
    success: 'hsl(145, 80%, 50%)',
    notice: 'hsl(43, 100%, 55%)',
    warning: 'hsl(43, 100%, 50%)',
    danger: 'hsl(0, 80%, 55%)',
  },
  components: {
    dialog: {
      surface: 'hsl(270, 25%, 14%)',
    },
    sidebar: {
      surface: 'hsl(270, 23%, 15%)',
      border: 'hsl(270, 22%, 22%)',
    },
    appHeader: {
      surface: 'hsl(270, 25%, 13%)',
      border: 'hsl(270, 22%, 20%)',
    },
    responsePane: {
      surface: 'hsl(270, 23%, 15%)',
      border: 'hsl(270, 22%, 22%)',
    },
    button: {
      primary: 'hsl(165, 100%, 35%)',
      secondary: 'hsl(270, 12%, 58%)',
      info: 'hsl(195, 95%, 48%)',
      success: 'hsl(145, 80%, 45%)',
      notice: 'hsl(43, 100%, 48%)',
      warning: 'hsl(43, 100%, 45%)',
      danger: 'hsl(0, 80%, 48%)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const solarizedDark: Theme = {
  id: 'solarized-dark',
  label: 'Solarized Dark',
  dark: true,
  base: {
    surface: '#002b36',
    surfaceHighlight: '#073642',
    text: '#839496',
    textSubtle: '#657b83',
    textSubtlest: '#586e75',
    primary: '#268bd2',
    secondary: '#657b83',
    info: '#268bd2',
    success: '#859900',
    notice: '#b58900',
    warning: '#cb4b16',
    danger: '#dc322f',
  },
  components: {
    dialog: {
      surface: '#002b36',
    },
    sidebar: {
      surface: '#073642',
      border: 'hsl(192,81%,17%)',
    },
    appHeader: {
      surface: '#002b36',
      border: 'hsl(192,81%,16%)',
    },
    responsePane: {
      surface: '#073642',
      border: 'hsl(192,81%,17%)',
    },
    button: {
      primary: '#268bd2',
      secondary: '#657b83',
      info: '#268bd2',
      success: '#859900',
      notice: '#b58900',
      warning: '#cb4b16',
      danger: '#dc322f',
    },
  },
};

export const solarizedLight: Theme = {
  id: 'solarized-light',
  label: 'Solarized Light',
  dark: false,
  base: {
    surface: '#fdf6e3',
    surfaceHighlight: '#eee8d5',
    text: '#657b83',
    textSubtle: '#839496',
    textSubtlest: '#93a1a1',
    primary: '#268bd2',
    secondary: '#839496',
    info: '#268bd2',
    success: '#859900',
    notice: '#b58900',
    warning: '#cb4b16',
    danger: '#dc322f',
  },
  components: {
    sidebar: {
      surface: '#eee8d5',
      border: '#d3cbb7',
    },
    appHeader: {
      surface: '#eee8d5',
      border: '#d3cbb7',
    },
  },
};

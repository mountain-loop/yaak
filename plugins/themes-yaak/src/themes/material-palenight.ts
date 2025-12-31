import type { Theme } from '@yaakapp/api';

export const materialPalenight: Theme = {
  id: 'material-palenight',
  label: 'Material Palenight',
  dark: true,
  base: {
    surface: '#292D3E',
    surfaceHighlight: '#313850',
    text: '#BFC7D5',
    textSubtle: '#697098',
    textSubtlest: '#4E5579',
    primary: '#c792ea',
    secondary: '#697098',
    info: '#82AAFF',
    success: '#C3E88D',
    notice: '#FFCB6B',
    warning: '#F78C6C',
    danger: '#ff5572',
  },
  components: {
    dialog: {
      surface: '#232635',
    },
    sidebar: {
      surface: '#292D3E',
    },
    appHeader: {
      surface: '#282C3D',
    },
    responsePane: {
      surface: '#313850',
      border: '#3a3f58',
    },
    button: {
      primary: '#c792ea',
      secondary: '#697098',
      info: '#82AAFF',
      success: '#C3E88D',
      notice: '#FFCB6B',
      warning: '#F78C6C',
      danger: '#ff5572',
    },
  },
};

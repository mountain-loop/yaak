import type { Theme } from '@yaakapp/api';

export const cobalt2: Theme = {
  id: 'cobalt2',
  label: 'Cobalt2',
  dark: true,
  base: {
    surface: '#193549',
    surfaceHighlight: '#1f4662',
    text: '#d2e1f1',
    textSubtle: '#709ac8',
    textSubtlest: '#55749e',
    primary: '#ffc600',
    secondary: '#819fc3',
    info: '#0088FF',
    success: '#3AD900',
    notice: '#FFEE80',
    warning: '#FF9D00',
    danger: '#FF628C',
  },
  components: {
    sidebar: {
      surface: '#13283a',
      border: '#102332',
    },
    input: {
      border: '#1f4561',
    },
    appHeader: {
      surface: '#13283a',
      border: '#112636',
    },
    responsePane: {
      surface: '#13283a',
      border: '#112636',
    },
    button: {
      primary: '#ffc600',
      secondary: '#709ac8',
      info: '#0088FF',
      success: '#3AD900',
      notice: '#ecdc6a',
      warning: '#FF9D00',
      danger: '#FF628C',
    },
  },
};

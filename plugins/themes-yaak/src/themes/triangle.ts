import type { Theme } from '@yaakapp/api';

export const triangle: Theme = {
  id: 'triangle',
  dark: true,
  label: 'Triangle',
  base: {
    surface: 'rgb(0,0,0)',
    surfaceHighlight: 'rgb(21,21,21)',
    surfaceActive: 'rgb(31,31,31)',
    text: 'rgb(237,237,237)',
    textSubtle: 'rgb(161,161,161)',
    textSubtlest: 'rgb(115,115,115)',
    border: 'rgb(31,31,31)',
    primary: 'rgb(196,114,251)',
    secondary: 'rgb(161,161,161)',
    info: 'rgb(71,168,255)',
    success: 'rgb(0,202,81)',
    notice: 'rgb(255,175,0)',
    warning: '#FF4C8D',
    danger: '#fd495a',
  },
  components: {
    editor: {
      danger: '#FF4C8D',
      warning: '#fd495a',
    },
    dialog: {
      surface: 'rgb(10,10,10)',
      border: 'rgb(31,31,31)',
    },
    sidebar: {
      border: 'rgb(31,31,31)',
    },
    responsePane: {
      surface: 'rgb(10,10,10)',
      border: 'rgb(31,31,31)',
    },
    appHeader: {
      surface: 'rgb(10,10,10)',
      border: 'rgb(31,31,31)',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const nord: Theme = {
  id: 'nord',
  label: 'Nord',
  dark: true,
  base: {
    surface: 'hsl(220,16%,22%)',
    surfaceHighlight: 'hsl(220,14%,28%)',
    text: 'hsl(220,28%,93%)',
    textSubtle: 'hsl(220,26%,90%)',
    textSubtlest: 'hsl(220,24%,86%)',
    primary: 'hsl(193,38%,68%)',
    secondary: 'hsl(210,34%,63%)',
    info: 'hsl(174,25%,69%)',
    success: 'hsl(89,26%,66%)',
    notice: 'hsl(40,66%,73%)',
    warning: 'hsl(17,48%,64%)',
    danger: 'hsl(353,43%,56%)',
  },
  components: {
    sidebar: {
      surface: 'hsl(220,16%,22%)',
    },
    appHeader: {
      surface: 'hsl(220,14%,28%)',
    },
  },
};

export const nordLight: Theme = {
  id: 'nord-light',
  label: 'Nord Light',
  dark: false,
  base: {
    surface: '#eceff4',
    surfaceHighlight: '#e5e9f0',
    text: '#24292e',
    textSubtle: '#444d56',
    textSubtlest: '#586069',
    primary: '#2188ff',
    secondary: '#586069',
    info: '#005cc5',
    success: '#28a745',
    notice: '#e36209',
    warning: '#e36209',
    danger: '#cb2431',
  },
  components: {
    sidebar: {
      surface: '#e5e9f0',
    },
    appHeader: {
      surface: '#e5e9f0',
    },
  },
};

export const nordLightBrighter: Theme = {
  id: 'nord-light-brighter',
  label: 'Nord Light Brighter',
  dark: false,
  base: {
    surface: '#ffffff',
    surfaceHighlight: '#f6f8fa',
    text: '#24292e',
    textSubtle: '#444d56',
    textSubtlest: '#586069',
    primary: '#2188ff',
    secondary: '#586069',
    info: '#005cc5',
    success: '#28a745',
    notice: '#e36209',
    warning: '#e36209',
    danger: '#cb2431',
  },
  components: {
    sidebar: {
      surface: '#f6f8fa',
    },
    appHeader: {
      surface: '#f6f8fa',
    },
  },
};

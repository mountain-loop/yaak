import type { Theme } from '@yaakapp/api';

export const shadesOfPurple: Theme = {
  id: 'shades-of-purple',
  label: 'Shades of Purple',
  dark: true,
  base: {
    surface: '#2D2B55',
    surfaceHighlight: '#1F1F41',
    text: '#FFFFFF',
    textSubtle: '#A599E9',
    textSubtlest: '#7E72C4',
    primary: '#FAD000',
    secondary: '#A599E9',
    info: '#80FFBB',
    success: '#3AD900',
    notice: '#FAD000',
    warning: '#FF9D00',
    danger: '#EC3A37F5',
  },
  components: {
    dialog: {
      surface: '#1E1E3F',
    },
    sidebar: {
      surface: '#222244',
      border: '#1E1E3F',
    },
    input: {
      border: '#7E72C4',
    },
    appHeader: {
      surface: '#1E1E3F',
      border: '#1E1E3F',
    },
    responsePane: {
      surface: 'hsl(240,33%,20%)',
      border: 'hsl(240,33%,20%)',
    },
    button: {
      primary: '#FAD000',
      secondary: '#A599E9',
      info: '#80FFBB',
      success: '#3AD900',
      notice: '#FAD000',
      warning: '#FF9D00',
      danger: '#EC3A37F5',
    },
  },
};

export const shadesOfPurpleSuperDark: Theme = {
  id: 'shades-of-purple-super-dark',
  label: 'Shades of Purple (Super Dark)',
  dark: true,
  base: {
    surface: '#191830',
    surfaceHighlight: '#1F1E3A',
    text: '#FFFFFF',
    textSubtle: '#A599E9',
    textSubtlest: '#7E72C4',
    primary: '#FAD000',
    secondary: '#A599E9',
    info: '#80FFBB',
    success: '#3AD900',
    notice: '#FAD000',
    warning: '#FF9D00',
    danger: '#EC3A37F5',
  },
  components: {
    dialog: {
      surface: '#15152b',
    },
    input: {
      border: '#2D2B55',
    },
    sidebar: {
      surface: '#131327',
      border: '#131327',
    },
    appHeader: {
      surface: '#15152a',
      border: '#15152a',
    },
    responsePane: {
      surface: '#131327',
      border: '#131327',
    },
    button: {
      primary: '#FAD000',
      secondary: '#A599E9',
      info: '#80FFBB',
      success: '#3AD900',
      notice: '#FAD000',
      warning: '#FF9D00',
      danger: '#EC3A37F5',
    },
  },
};

import type { Theme } from '@yaakapp/api';

export const highContrast: Theme = {
  id: 'high-contrast',
  label: 'High Contrast Light',
  dark: false,
  base: {
    surface: 'white',
    surfaceHighlight: 'hsl(218,24%,93%)',
    text: 'black',
    textSubtle: 'hsl(217,24%,40%)',
    textSubtlest: 'hsl(217,24%,40%)',
    border: 'hsl(217,22%,50%)',
    borderSubtle: 'hsl(217,22%,60%)',
    primary: 'hsl(267,67%,47%)',
    secondary: 'hsl(218,18%,53%)',
    info: 'hsl(206,100%,36%)',
    success: 'hsl(155,100%,26%)',
    notice: 'hsl(45,100%,31%)',
    warning: 'hsl(30,99%,34%)',
    danger: 'hsl(334,100%,35%)',
  },
};

export const highContrastDark: Theme = {
  id: 'high-contrast-dark',
  label: 'High Contrast Dark',
  dark: true,
  base: {
    surface: 'hsl(0,0%,0%)',
    surfaceHighlight: 'hsl(0,0%,20%)',
    text: 'hsl(0,0%,100%)',
    textSubtle: 'hsl(0,0%,90%)',
    textSubtlest: 'hsl(0,0%,80%)',
    selection: 'hsl(276,100%,30%)',
    surfaceActive: 'hsl(276,100%,30%)',
    border: 'hsl(0,0%,60%)',
    primary: 'hsl(266,100%,85%)',
    secondary: 'hsl(242,20%,72%)',
    info: 'hsl(208,100%,83%)',
    success: 'hsl(150,100%,63%)',
    notice: 'hsl(49,100%,77%)',
    warning: 'hsl(28,100%,73%)',
    danger: 'hsl(343,100%,79%)',
  },
};

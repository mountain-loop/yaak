import type { Theme } from '@yaakapp/api';

export const rosePine: Theme = {
  id: 'rose-pine',
  label: 'Rosé Pine',
  dark: true,
  base: {
    surface: 'hsl(249,22%,12%)',
    text: 'hsl(245,50%,91%)',
    textSubtle: 'hsl(248,15%,61%)',
    textSubtlest: 'hsl(249,12%,47%)',
    primary: 'hsl(267,57%,78%)',
    secondary: 'hsl(249,12%,47%)',
    info: 'hsl(199,49%,60%)',
    success: 'hsl(180,43%,73%)',
    notice: 'hsl(35,88%,72%)',
    warning: 'hsl(1,74%,79%)',
    danger: 'hsl(343,76%,68%)',
  },
  components: {
    responsePane: {
      surface: 'hsl(247,23%,15%)',
    },
    sidebar: {
      surface: 'hsl(247,23%,15%)',
    },
    menu: {
      surface: 'hsl(248,21%,26%)',
      textSubtle: 'hsl(248,15%,66%)',
      textSubtlest: 'hsl(249,12%,52%)',
      border: 'hsl(248,21%,35%)',
      borderSubtle: 'hsl(248,21%,33%)',
    },
  },
};

export const rosePineMoon: Theme = {
  id: 'rose-pine-moon',
  label: 'Rosé Pine Moon',
  dark: true,
  base: {
    surface: 'hsl(246,24%,17%)',
    text: 'hsl(245,50%,91%)',
    textSubtle: 'hsl(248,15%,61%)',
    textSubtlest: 'hsl(249,12%,47%)',
    primary: 'hsl(267,57%,78%)',
    secondary: 'hsl(248,15%,61%)',
    info: 'hsl(197,48%,60%)',
    success: 'hsl(197,48%,60%)',
    notice: 'hsl(35,88%,72%)',
    warning: 'hsl(2,66%,75%)',
    danger: 'hsl(343,76%,68%)',
  },
  components: {
    responsePane: {
      surface: 'hsl(247,24%,20%)',
    },
    sidebar: {
      surface: 'hsl(247,24%,20%)',
    },
    menu: {
      surface: 'hsl(248,21%,26%)',
      textSubtle: 'hsl(248,15%,61%)',
      textSubtlest: 'hsl(249,12%,55%)',
      border: 'hsl(248,21%,35%)',
      borderSubtle: 'hsl(248,21%,31%)',
    },
  },
};

export const rosePineDawn: Theme = {
  id: 'rose-pine-dawn',
  label: 'Rosé Pine Dawn',
  dark: false,
  base: {
    surface: 'hsl(32,57%,95%)',
    border: 'hsl(10,9%,86%)',
    surfaceHighlight: 'hsl(25,35%,93%)',
    text: 'hsl(248,19%,40%)',
    textSubtle: 'hsl(248,12%,52%)',
    textSubtlest: 'hsl(257,9%,61%)',
    primary: 'hsl(271,27%,56%)',
    secondary: 'hsl(249,12%,47%)',
    info: 'hsl(197,52%,36%)',
    success: 'hsl(188,31%,45%)',
    notice: 'hsl(34,64%,49%)',
    warning: 'hsl(2,47%,64%)',
    danger: 'hsl(343,35%,55%)',
  },
  components: {
    responsePane: {
      border: 'hsl(20,12%,90%)',
    },
    sidebar: {
      border: 'hsl(20,12%,90%)',
    },
    appHeader: {
      border: 'hsl(20,12%,90%)',
    },
    input: {
      border: 'hsl(10,9%,86%)',
    },
    dialog: {
      border: 'hsl(20,12%,90%)',
    },
    menu: {
      surface: 'hsl(28,40%,92%)',
      border: 'hsl(10,9%,86%)',
    },
  },
};

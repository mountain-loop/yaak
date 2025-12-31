import type { Theme } from '@yaakapp/api';

export const githubDark: Theme = {
  id: 'github-dark',
  label: 'GitHub',
  dark: true,
  base: {
    surface: 'hsl(213,30%,7%)',
    surfaceHighlight: 'hsl(213,16%,13%)',
    text: 'hsl(212,27%,89%)',
    textSubtle: 'hsl(212,9%,57%)',
    textSubtlest: 'hsl(217,8%,45%)',
    border: 'hsl(215,21%,11%)',
    primary: 'hsl(262,78%,74%)',
    secondary: 'hsl(217,8%,50%)',
    info: 'hsl(215,84%,64%)',
    success: 'hsl(129,48%,52%)',
    notice: 'hsl(39,71%,58%)',
    warning: 'hsl(22,83%,60%)',
    danger: 'hsl(3,83%,65%)',
  },
  components: {
    button: {
      primary: 'hsl(262,79%,71%)',
      secondary: 'hsl(217,8%,45%)',
      info: 'hsl(215,84%,60%)',
      success: 'hsl(129,48%,47%)',
      notice: 'hsl(39,71%,53%)',
      warning: 'hsl(22,83%,56%)',
      danger: 'hsl(3,83%,61%)',
    },
  },
};

export const githubLight: Theme = {
  id: 'github-light',
  label: 'GitHub',
  dark: false,
  base: {
    surface: 'hsl(0,0%,100%)',
    surfaceHighlight: 'hsl(210,29%,94%)',
    text: 'hsl(213,13%,14%)',
    textSubtle: 'hsl(212,9%,43%)',
    textSubtlest: 'hsl(203,8%,55%)',
    border: 'hsl(210,15%,92%)',
    borderSubtle: 'hsl(210,15%,92%)',
    primary: 'hsl(261,69%,59%)',
    secondary: 'hsl(212,8%,47%)',
    info: 'hsl(212,92%,48%)',
    success: 'hsl(137,66%,32%)',
    notice: 'hsl(40,100%,40%)',
    warning: 'hsl(24,100%,44%)',
    danger: 'hsl(356,71%,48%)',
  },
};

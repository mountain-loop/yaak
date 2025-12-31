import type { PluginDefinition } from '@yaakapp/api';

// Import all themes
import { oneDarkPro } from './themes/one-dark-pro';
import { materialPalenight } from './themes/material-palenight';
import { materialOcean } from './themes/material-ocean';
import { materialDarker } from './themes/material-darker';
import { nightOwl, lightOwl } from './themes/night-owl';
import { tokyoNight, tokyoNightStorm, tokyoNightDay } from './themes/tokyo-night';
import { solarizedDark, solarizedLight } from './themes/solarized';
import { ayuDark, ayuMirage, ayuLight } from './themes/ayu';
import { synthwave84 } from './themes/synthwave-84';
import { shadesOfPurple, shadesOfPurpleSuperDark } from './themes/shades-of-purple';
import { cobalt2 } from './themes/cobalt2';
import { horizon } from './themes/horizon';
import { pandaSyntax } from './themes/panda';
import { andromeda } from './themes/andromeda';
import { winterIsComing } from './themes/winter-is-coming';
import { atomOneDark } from './themes/atom-one-dark';
import { vitesseDark, vitesseLight } from './themes/vitesse';
import { everforestDark, everforestLight } from './themes/everforest';
import { githubDarkDimmed } from './themes/github-dimmed';
import { slackAubergine } from './themes/slack';
import { noctisAzureus } from './themes/noctis';
import { blulocoDark, blulocoLight } from './themes/bluloco';

export const plugin: PluginDefinition = {
  themes: [
    // One Dark variants
    oneDarkPro,
    atomOneDark,

    // Material Theme variants
    materialPalenight,
    materialOcean,
    materialDarker,

    // Night Owl variants
    nightOwl,
    lightOwl,

    // Tokyo Night variants
    tokyoNight,
    tokyoNightStorm,
    tokyoNightDay,

    // Solarized variants
    solarizedDark,
    solarizedLight,

    // Ayu variants
    ayuDark,
    ayuMirage,
    ayuLight,

    // Retro / Neon themes
    synthwave84,
    shadesOfPurple,
    shadesOfPurpleSuperDark,

    // Blue themes
    cobalt2,
    noctisAzureus,

    // Warm themes
    horizon,

    // Minimal themes
    pandaSyntax,
    vitesseDark,
    vitesseLight,

    // Nature themes
    everforestDark,
    everforestLight,

    // Space themes
    andromeda,
    winterIsComing,

    // GitHub themes
    githubDarkDimmed,

    // App-inspired themes
    slackAubergine,

    // Bluloco themes
    blulocoDark,
    blulocoLight,
  ],
};

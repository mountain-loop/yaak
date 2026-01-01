import type { PluginDefinition } from '@yaakapp/api';
import { andromeda } from './themes/andromeda';
import { atomOneDark } from './themes/atom-one-dark';
import { ayuDark, ayuLight, ayuMirage } from './themes/ayu';
import { blulocoDark, blulocoLight } from './themes/bluloco';
import {
  catppuccinFrappe,
  catppuccinLatte,
  catppuccinMacchiato,
  catppuccinMocha,
} from './themes/catppuccin';
import { cobalt2 } from './themes/cobalt2';
import { dracula } from './themes/dracula';
import { everforestDark, everforestLight } from './themes/everforest';
import { fleetDark, fleetDarkPurple, fleetLight } from './themes/fleet';
import { githubDark, githubLight } from './themes/github';
import { githubDarkDimmed } from './themes/github-dimmed';
import { gruvbox } from './themes/gruvbox';
// Yaak themes
import { highContrast, highContrastDark } from './themes/high-contrast';
import { horizon } from './themes/horizon';
import { hotdogStand } from './themes/hotdog-stand';
import { materialDarker } from './themes/material-darker';
import { materialOcean } from './themes/material-ocean';
import { materialPalenight } from './themes/material-palenight';
import {
  monokaiPro,
  monokaiProClassic,
  monokaiProMachine,
  monokaiProOctagon,
  monokaiProRistretto,
  monokaiProSpectrum,
} from './themes/monokai-pro';
import { moonlight } from './themes/moonlight';
import { lightOwl, nightOwl } from './themes/night-owl';
import { noctisAzureus } from './themes/noctis';
import { nord, nordLight, nordLightBrighter } from './themes/nord';
// VSCode themes
import { oneDarkPro } from './themes/one-dark-pro';
import { pandaSyntax } from './themes/panda';
import { relaxing } from './themes/relaxing';
import { rosePine, rosePineDawn, rosePineMoon } from './themes/rose-pine';
import { shadesOfPurple, shadesOfPurpleSuperDark } from './themes/shades-of-purple';
import { slackAubergine } from './themes/slack';
import { solarizedDark, solarizedLight } from './themes/solarized';
import { synthwave84 } from './themes/synthwave-84';
import { tokyoNight, tokyoNightDay, tokyoNightStorm } from './themes/tokyo-night';
import { triangle } from './themes/triangle';
import { vitesseDark, vitesseLight } from './themes/vitesse';
import { winterIsComing } from './themes/winter-is-coming';

export const plugin: PluginDefinition = {
  themes: [
    andromeda,
    atomOneDark,
    ayuDark,
    ayuLight,
    ayuMirage,
    blulocoDark,
    blulocoLight,
    catppuccinFrappe,
    catppuccinLatte,
    catppuccinMacchiato,
    catppuccinMocha,
    cobalt2,
    dracula,
    everforestDark,
    everforestLight,
    fleetDark,
    fleetDarkPurple,
    fleetLight,
    githubDark,
    githubDarkDimmed,
    githubLight,
    gruvbox,
    highContrast,
    highContrastDark,
    horizon,
    hotdogStand,
    lightOwl,
    materialDarker,
    materialOcean,
    materialPalenight,
    monokaiPro,
    monokaiProClassic,
    monokaiProMachine,
    monokaiProOctagon,
    monokaiProRistretto,
    monokaiProSpectrum,
    moonlight,
    nightOwl,
    noctisAzureus,
    nord,
    nordLight,
    nordLightBrighter,
    oneDarkPro,
    pandaSyntax,
    relaxing,
    rosePine,
    rosePineDawn,
    rosePineMoon,
    shadesOfPurple,
    shadesOfPurpleSuperDark,
    slackAubergine,
    solarizedDark,
    solarizedLight,
    synthwave84,
    tokyoNight,
    tokyoNightDay,
    tokyoNightStorm,
    triangle,
    vitesseDark,
    vitesseLight,
    winterIsComing,
  ],
};

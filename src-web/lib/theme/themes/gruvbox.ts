import type { YaakTheme } from '../window';
import { YaakColor } from '../yaakColor';

export const gruvboxDefault: YaakTheme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  surface: new YaakColor('#282828', 'dark'),
  surfaceHighlight: new YaakColor('#32302f', 'dark'),
  text: new YaakColor('#f9f5d7', 'dark'),
  textSubtle: new YaakColor('#bdae93', 'dark'),
  textSubtlest: new YaakColor('#928374', 'dark'),
  primary: new YaakColor('#d3869b', 'dark'),
  secondary: new YaakColor('#83a598', 'dark'),
  info: new YaakColor('#8ec07c', 'dark'),
  success: new YaakColor('#b8bb26', 'dark'),
  notice: new YaakColor('#fabd2f', 'dark'),
  warning: new YaakColor('#fe8019', 'dark'),
  danger: new YaakColor('#fb4934', 'dark'),
};

export const gruvbox = [gruvboxDefault];

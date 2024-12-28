import { YaakColor } from '../yaakColor';
import type { YaakTheme } from '../window';

const kanagawaDragon: YaakTheme = {
  id: 'kanagawa-dragon',
  name: 'Kanagawa Dragon',
  surface: new YaakColor('#181616', 'dark'),
  border: new YaakColor('#3B4045', 'dark'),
  surfaceHighlight: new YaakColor('#393836', 'dark'),
  text: new YaakColor('#C5C9C5', 'dark'),
  textSubtle: new YaakColor('#C8C093', 'dark'),
  textSubtlest: new YaakColor('#8EA4A2', 'dark'),
  primary: new YaakColor('#C8C093', 'dark').lift(0.1),
  secondary: new YaakColor('#C5C9C5', 'dark').lift(0.1),
  info: new YaakColor('#C5C9C5', 'dark').lift(0.1),
  success: new YaakColor('#87A987', 'dark').lift(0.1),
  notice: new YaakColor('#E6C384', 'dark').lift(0.1),
  warning: new YaakColor('#C4746E', 'dark').lift(0.1),
  danger: new YaakColor('#E46876', 'dark').lift(0.1),
  components: {
    button: {
      primary: new YaakColor('#C8C093', 'dark'),
      secondary: new YaakColor('#7B6C9E', 'dark'),
      info: new YaakColor('#7FB4CA', 'dark'),
      success: new YaakColor('#87A987', 'dark'),
      notice: new YaakColor('#E6C384', 'dark'),
      warning: new YaakColor('#C4746E', 'dark'),
      danger: new YaakColor('#E46876', 'dark'),
    },
    editor: {
      primary: new YaakColor('#A292A3', 'dark'),
      secondary: new YaakColor('#AA0000', 'dark'),
      info: new YaakColor('#A292A3', 'dark'),
      success: new YaakColor('#C5C9C5', 'dark'),
      notice: new YaakColor('#8A9A7B', 'dark'),
      danger: new YaakColor('#B6927B', 'dark'),
    },
  },
};

export const kanagawa = [kanagawaDragon];

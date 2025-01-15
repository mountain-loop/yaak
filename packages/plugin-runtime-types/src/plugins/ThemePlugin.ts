import type { Theme } from '../themes';
import type { Context } from './Context';

export type ThemePlugin = {
  name: string;
  description?: string;
  getTheme(ctx: Context, fileContents: string): Promise<Theme>;
};

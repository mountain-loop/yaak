import type { Color } from '@yaakapp-internal/plugins';

const colors: Record<Color, boolean> = {
  primary: true,
  secondary: true,
  success: true,
  notice: true,
  warning: true,
  danger: true,
  info: true,
};

export function stringToColor(str: string | null): Color | null {
  if (!str) return null;
  const strLower = str.toLowerCase();
  if (strLower in colors) {
    return strLower as Color;
  }
  return null;
}

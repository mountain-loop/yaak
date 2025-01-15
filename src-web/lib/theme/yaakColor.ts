import parseColor from 'parse-color';

export class YaakColor {
  private readonly appearance: 'dark' | 'light' = 'light';

  private hue: number = 0;
  private saturation: number = 0;
  private lightness: number = 0;
  private alpha: number = 1;

  constructor(cssColor: string, appearance: 'dark' | 'light' = 'light') {
    try {
      this.set(cssColor);
      this.appearance = appearance;
    } catch (err) {
      console.log('Failed to parse CSS color', cssColor, err);
    }
  }

  static transparent(): YaakColor {
    return new YaakColor('rgb(0,0,0)', 'light').translucify(1);
  }

  static white(): YaakColor {
    return new YaakColor('rgb(0,0,0)', 'light').lower(1);
  }

  static black(): YaakColor {
    return new YaakColor('rgb(0,0,0)', 'light').lift(1);
  }

  set(cssColor: string): YaakColor {
    if (cssColor.startsWith('#') && cssColor.length === 9) {
      const [r, g, b, a] = hexToRgba(cssColor);
      cssColor = `rgba(${r},${g},${b},${a})`;
    }
    const { hsla } = parseColor(cssColor);
    this.hue = hsla[0];
    this.saturation = hsla[1];
    this.lightness = hsla[2];
    this.alpha = hsla[3] ?? 1;
    return this;
  }

  clone(): YaakColor {
    return new YaakColor(this.css(), this.appearance);
  }

  lower(mod: number): YaakColor {
    return this.appearance === 'dark' ? this._darken(mod) : this._lighten(mod);
  }

  lift(mod: number): YaakColor {
    return this.appearance === 'dark' ? this._lighten(mod) : this._darken(mod);
  }

  minLightness(n: number): YaakColor {
    const c = this.clone();
    if (c.lightness < n) {
      c.lightness = n;
    }
    return c;
  }

  isDark(): boolean {
    return this.lightness < 50;
  }

  translucify(mod: number): YaakColor {
    const c = this.clone();
    c.alpha = c.alpha - c.alpha * mod;
    return c;
  }

  opacify(mod: number): YaakColor {
    const c = this.clone();
    c.alpha = this.alpha + (100 - this.alpha) * mod;
    return c;
  }

  desaturate(mod: number): YaakColor {
    const c = this.clone();
    c.saturation = c.saturation - c.saturation * mod;
    return c;
  }

  saturate(mod: number): YaakColor {
    const c = this.clone();
    c.saturation = this.saturation + (100 - this.saturation) * mod;
    return c;
  }

  lighterThan(c: YaakColor): boolean {
    return this.lightness > c.lightness;
  }

  css(): string {
    const h = this.hue;
    const s = this.saturation;
    const l = this.lightness;
    const a = this.alpha;

    const [r, g, b] = parseColor(`hsl(${h},${s}%,${l}%)`).rgb;
    return rgbaToHex(r, g, b, a);
  }

  hexNoAlpha(): string {
    const h = this.hue;
    const s = this.saturation;
    const l = this.lightness;

    const [r, g, b] = parseColor(`hsl(${h},${s}%,${l}%)`).rgb;
    return rgbaToHexNoAlpha(r, g, b);
  }

  private _lighten(mod: number): YaakColor {
    const c = this.clone();
    c.lightness = this.lightness + (100 - this.lightness) * mod;
    return c;
  }

  private _darken(mod: number): YaakColor {
    const c = this.clone();
    c.lightness = this.lightness - this.lightness * mod;
    return c;
  }
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const toHex = (n: number): string => {
    const hex = Number(Math.round(n)).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return '#' + [toHex(r), toHex(g), toHex(b), toHex(a * 255)].join('').toUpperCase();
}

function rgbaToHexNoAlpha(r: number, g: number, b: number): string {
  const toHex = (n: number): string => {
    const hex = Number(Math.round(n)).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return '#' + [toHex(r), toHex(g), toHex(b)].join('').toUpperCase();
}

function hexToRgba(hex: string): [number, number, number, number] {
  const fromHex = (h: string): number => {
    if (h === '') return 255;
    return Number(`0x${h}`);
  };

  const r = fromHex(hex.slice(1, 3));
  const g = fromHex(hex.slice(3, 5));
  const b = fromHex(hex.slice(5, 7));
  const a = fromHex(hex.slice(7, 9));

  return [r, g, b, a / 255];
}

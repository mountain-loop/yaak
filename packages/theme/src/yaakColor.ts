import parseColor from "parse-color";

export class YaakColor {
  private readonly appearance: "dark" | "light" = "light";

  private lightness = 0;
  private chroma = 0;
  private hue = 0;
  private alpha = 1;

  constructor(cssColor: string, appearance: "dark" | "light" = "light") {
    try {
      this.set(cssColor);
      this.appearance = appearance;
    } catch (err) {
      console.log("Failed to parse CSS color", cssColor, err);
    }
  }

  static transparent(): YaakColor {
    return new YaakColor("rgb(0,0,0)", "light").translucify(1);
  }

  static white(): YaakColor {
    return new YaakColor("rgb(0,0,0)", "light").lower(999);
  }

  static black(): YaakColor {
    return new YaakColor("rgb(0,0,0)", "light").lift(999);
  }

  set(cssColor: string): YaakColor {
    let fixedCssColor = cssColor;
    if (cssColor.startsWith("#") && cssColor.length === 9) {
      const [r, g, b, a] = hexToRgba(cssColor);
      fixedCssColor = `rgba(${r},${g},${b},${a})`;
    }

    const oklch = parseOklch(fixedCssColor);
    if (oklch != null) {
      this.lightness = oklch.lightness;
      this.chroma = oklch.chroma;
      this.hue = oklch.hue;
      this.alpha = oklch.alpha;
      return this;
    }

    const { rgba } = parseColor(fixedCssColor);
    const [lightness, chroma, hue] = rgbToOklch(rgba[0], rgba[1], rgba[2]);
    this.lightness = lightness;
    this.chroma = chroma;
    this.hue = hue;
    this.alpha = rgba[3] ?? 1;
    return this;
  }

  clone(): YaakColor {
    return new YaakColor(this.css(), this.appearance);
  }

  themeColor(cssColor: string): YaakColor {
    return new YaakColor(cssColor, this.appearance);
  }

  lower(mod: number): YaakColor {
    return this.appearance === "dark" ? this._darken(mod) : this._lighten(mod);
  }

  lift(mod: number): YaakColor {
    return this.appearance === "dark" ? this._lighten(mod) : this._darken(mod);
  }

  liftMax(): YaakColor {
    return this.lift(999);
  }

  lowerMax(): YaakColor {
    return this.lower(999);
  }

  themeSurface(): YaakColor {
    return new YaakColor(
      this.appearance === "dark" ? "oklch(23% 0 0)" : "oklch(100% 0 0)",
      this.appearance,
    );
  }

  minLightness(n: number): YaakColor {
    const color = this.clone();
    if (color.lightness < n) {
      color.lightness = n;
    }
    return color;
  }

  isDark(): boolean {
    return this.lightness < 50;
  }

  translucify(mod: number): YaakColor {
    const color = this.clone();
    color.alpha = clamp(color.alpha - color.alpha * mod, 0, 1);
    return color;
  }

  opacify(mod: number): YaakColor {
    const color = this.clone();
    color.alpha = clamp(this.alpha + (1 - this.alpha) * mod, 0, 1);
    return color;
  }

  desaturate(mod: number): YaakColor {
    const color = this.clone();
    color.chroma = color.chroma - color.chroma * mod;
    return color;
  }

  saturate(mod: number): YaakColor {
    const color = this.clone();
    color.chroma = this.chroma + this.chroma * mod;
    return color;
  }

  lighterThan(color: YaakColor): boolean {
    return this.lightness > color.lightness;
  }

  contrastRatio(background: YaakColor): number {
    const foreground = this.alpha < 1 ? this.compositeOver(background) : this;
    const foregroundLuminance = foreground.relativeLuminance();
    const backgroundLuminance = background.relativeLuminance();
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  withContrast(background: YaakColor, minContrast: number): YaakColor {
    const darker = this.clone();
    darker.lightness = 0;
    darker.chroma = 0;
    darker.hue = 0;

    const lighter = this.clone();
    lighter.lightness = 100;
    lighter.chroma = 0;
    lighter.hue = 0;

    const darkerContrast = darker.contrastRatio(background);
    const lighterContrast = lighter.contrastRatio(background);
    let useLighterColor = lighterContrast >= darkerContrast;

    // Saturated accent surfaces often read better with white text even when
    // black has the higher numeric contrast. Keep yellow-ish light accents dark
    // by requiring white to clear a modest contrast floor first.
    if (minContrast >= 3 && lighterContrast >= 2.5) {
      useLighterColor = true;
    }

    const selectedContrast = useLighterColor ? lighterContrast : darkerContrast;
    if (selectedContrast < minContrast) {
      return useLighterColor ? lighter : darker;
    }

    let minLightness = 0;
    let maxLightness = 100;
    const color = this.clone();

    for (let i = 0; i < 24; i += 1) {
      color.lightness = (minLightness + maxLightness) / 2;
      const contrast = color.contrastRatio(background);

      if (useLighterColor) {
        if (contrast >= minContrast) {
          maxLightness = color.lightness;
        } else {
          minLightness = color.lightness;
        }
      } else if (contrast >= minContrast) {
        minLightness = color.lightness;
      } else {
        maxLightness = color.lightness;
      }
    }

    color.lightness = useLighterColor ? maxLightness : minLightness;
    return color;
  }

  compositeOver(background: YaakColor): YaakColor {
    const [fgR, fgG, fgB] = this.rgb();
    const [bgR, bgG, bgB] = background.rgb();
    const alpha = this.alpha + background.alpha * (1 - this.alpha);

    if (alpha <= 0) {
      return YaakColor.transparent();
    }

    const r = (fgR * this.alpha + bgR * background.alpha * (1 - this.alpha)) / alpha;
    const g = (fgG * this.alpha + bgG * background.alpha * (1 - this.alpha)) / alpha;
    const b = (fgB * this.alpha + bgB * background.alpha * (1 - this.alpha)) / alpha;

    return new YaakColor(`rgba(${r},${g},${b},${alpha})`, this.appearance);
  }

  css(): string {
    const [r, g, b] = this.rgb();
    return rgbaToHex(r, g, b, this.alpha);
  }

  hexNoAlpha(): string {
    const [r, g, b] = this.rgb();
    return rgbaToHexNoAlpha(r, g, b);
  }

  private relativeLuminance(): number {
    const [r, g, b] = this.rgb();
    const red = srgbToLinear(r / 255);
    const green = srgbToLinear(g / 255);
    const blue = srgbToLinear(b / 255);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  private rgb(): [number, number, number] {
    return oklchToRgb(this.lightness, this.chroma, this.hue);
  }

  private _lighten(mod: number): YaakColor {
    const color = this.clone();
    color.lightness = clamp(this.lightness + (100 - this.lightness) * mod, 0, 100);
    return color;
  }

  private _darken(mod: number): YaakColor {
    const color = this.clone();
    color.lightness = clamp(this.lightness - this.lightness * mod, 0, 100);
    return color;
  }
}

function parseOklch(
  cssColor: string,
): { lightness: number; chroma: number; hue: number; alpha: number } | null {
  const match = cssColor
    .trim()
    .match(
      /^oklch\(\s*([^\s,]+)(?:\s+|,\s*)([^\s,]+)(?:\s+|,\s*)([^\s,/]+)(?:\s*\/\s*([^)]+)|(?:\s*,\s*([^)]*))?)\s*\)$/i,
    );
  if (match == null) return null;

  const lightness = parseOklchLightness(match[1]);
  const chroma = parseCssNumber(match[2], 1);
  const hue = normalizeHue(parseCssNumber(match[3].replace(/deg$/i, ""), 1));
  const alpha = parseCssNumber(match[4] ?? match[5] ?? "1", 1);

  if (
    !Number.isFinite(lightness) ||
    !Number.isFinite(chroma) ||
    !Number.isFinite(hue) ||
    !Number.isFinite(alpha)
  ) {
    return null;
  }

  return {
    lightness: clamp(lightness, 0, 100),
    chroma: Math.max(0, chroma),
    hue,
    alpha: clamp(alpha, 0, 1),
  };
}

function parseCssNumber(value: string, percentScale: number): number {
  const normalized = value.trim();
  if (normalized.endsWith("%")) {
    return (Number.parseFloat(normalized) / 100) * percentScale;
  }
  return Number.parseFloat(normalized);
}

function parseOklchLightness(value: string): number {
  const parsed = parseCssNumber(value, 100);
  return value.trim().endsWith("%") || parsed > 1 ? parsed : parsed * 100;
}

function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const red = srgbToLinear(r / 255);
  const green = srgbToLinear(g / 255);
  const blue = srgbToLinear(b / 255);

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const okb = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return [
    lightness * 100,
    Math.sqrt(a * a + okb * okb),
    normalizeHue(radToDeg(Math.atan2(okb, a))),
  ];
}

function oklchToRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const l = clamp(lightness, 0, 100) / 100;
  const a = Math.cos(degToRad(hue)) * chroma;
  const b = Math.sin(degToRad(hue)) * chroma;

  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;

  const lCube = lRoot * lRoot * lRoot;
  const mCube = mRoot * mRoot * mRoot;
  const sCube = sRoot * sRoot * sRoot;

  const red = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const green = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const blue = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;

  return [linearToSrgb(red) * 255, linearToSrgb(green) * 255, linearToSrgb(blue) * 255];
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return clamp(srgb, 0, 1);
}

function normalizeHue(value: number): number {
  const hue = value % 360;
  return hue < 0 ? hue + 360 : hue;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const toHex = (n: number): string => {
    const hex = Number(Math.round(n)).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${[toHex(r), toHex(g), toHex(b), toHex(a * 255)].join("").toUpperCase()}`;
}

function rgbaToHexNoAlpha(r: number, g: number, b: number): string {
  const toHex = (n: number): string => {
    const hex = Number(Math.round(n)).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${[toHex(r), toHex(g), toHex(b)].join("").toUpperCase()}`;
}

function hexToRgba(hex: string): [number, number, number, number] {
  const fromHex = (value: string): number => {
    if (value === "") return 255;
    return Number(`0x${value}`);
  };

  const r = fromHex(hex.slice(1, 3));
  const g = fromHex(hex.slice(3, 5));
  const b = fromHex(hex.slice(5, 7));
  const a = fromHex(hex.slice(7, 9));

  return [r, g, b, a / 255];
}

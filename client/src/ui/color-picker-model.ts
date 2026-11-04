// Fork Ordahi: contas do seletor de cor (puro, sem DOM). A interface fica em color-picker.ts.

/** Matiz em graus (0–360), saturação e brilho de 0 a 1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** `#rgb`, `rgb`, `#rrggbb` ou `rrggbb` em `#rrggbb` minúsculo; null se não for uma cor. */
export function parseHex(raw: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const v = m[1].toLowerCase();
  return `#${v.length === 3 ? [...v].map((c) => c + c).join('') : v}`;
}

/** `fallbackHue`: cinza não tem matiz, e o controle não deve pular para o vermelho ao passar por ele. */
export function hexToHsv(hex: string, fallbackHue = 0): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = fallbackHue;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number): string => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

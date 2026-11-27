import { expect, test } from 'vitest';
import { tokens } from '../src/tokens.js';

function luminance(hex: string): number {
  function channel(offset: number): number {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

for (const [mode, colors] of Object.entries(tokens.colors)) {
  test(`${mode} text pairs meet the WCAG AA normal-text threshold`, () => {
    function check(foreground: keyof typeof colors, background: keyof typeof colors) {
      const a = luminance(colors[foreground]);
      const b = luminance(colors[background]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const foreground of ['text', 'muted', 'accent', 'success', 'warning', 'danger'] as const) {
      check(foreground, 'surface');
      check(foreground, 'background');
    }
    check('onPrimary', 'primary');
    check('onAccent', 'accent');
  });
}

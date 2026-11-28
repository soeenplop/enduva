// Writes the design tokens' colors as Xcode color sets, so the Apple apps use the same light and dark values as the
// web. Runs in the build (after swc), and the CI drift check fails when the committed catalogs are stale.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tokens } from './dist/tokens.js';

const apple = new URL('../../apps/apple/', import.meta.url);
const info = { author: 'xcode', version: 1 };

function component(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) => '0x' + hex.slice(start, start + 2).toUpperCase());
  return { color: { 'color-space': 'srgb', components: { alpha: '1.000', blue, green, red } }, idiom: 'universal' };
}

function colorset(token) {
  const dark = { appearances: [{ appearance: 'luminosity', value: 'dark' }], ...component(tokens.colors.dark[token]) };
  return { colors: [component(tokens.colors.light[token]), dark], info };
}

function write(catalog, colors, { clean = false } = {}) {
  const root = new URL(catalog + '/', apple);
  if (clean) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(new URL('Contents.json', root), JSON.stringify({ info }, null, 2) + '\n');
  for (const [name, token] of Object.entries(colors)) {
    const dir = new URL(name + '.colorset/', root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('Contents.json', dir), JSON.stringify(colorset(token), null, 2) + '\n');
  }
}

// EnduvaKit owns its catalog completely; the apps' catalogs only get the colors the system reads by name.
const semantic = Object.fromEntries(Object.keys(tokens.colors.light).map((token) => [token, token]));
write('EnduvaKit/Sources/EnduvaKit/Colors.xcassets', semantic, { clean: true });
write('Enduva/Assets.xcassets', { AccentColor: 'accent', LaunchBackground: 'background' });
write('EnduvaWatch/Assets.xcassets', { AccentColor: 'accent' });

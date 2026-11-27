import { readFileSync, writeFileSync } from 'node:fs';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

await initWasm(readFileSync(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
const brand = new URL('../assets/brand/final/', import.meta.url);
const read = (path) => readFileSync(new URL(path, brand), 'utf8');
const write = (path, data) => writeFileSync(new URL(path, brand), data);

function artwork(mode) {
  return ['background', 'sun', 'bowl']
    .map((name) => {
      const layer = read(`ios/${mode}/${name}.svg`);
      return layer.slice(layer.indexOf('>') + 1, layer.lastIndexOf('</svg>')).trim();
    })
    .join('\n');
}

function svg(content, width = 1024, height = width) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${content}\n</svg>\n`;
}
function raster(source, width) {
  const renderer = new Resvg(source, { fitTo: { mode: 'width', value: width } });
  const image = renderer.render();
  const png = Buffer.from(image.asPng());
  image.free();
  renderer.free();
  return png;
}

const light = artwork('light');
const dark = artwork('dark');
write(
  'web/favicon.svg',
  svg(`<title>Enduva</title>
<style>.dark{display:none}@media(prefers-color-scheme:dark){.dark{display:inline}.light{display:none}}</style>
<g class="light">${light}</g><g class="dark">${dark}</g>`),
);

const sizes = [
  [16, 'favicon-16'],
  [32, 'favicon-32'],
  [180, 'apple-touch-icon'],
  [192, 'icon-192'],
  [512, 'icon-512'],
];
for (const [size, name] of sizes) {
  write(`web/${name}.png`, raster(svg(light), size));
}
write('web/og.png', raster(read('web/og.svg'), 1200));

// ICO directory entries point to the two original PNG streams.
const header = Buffer.alloc(6 + 2 * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(2, 4);
const chunks = [header];
let offset = header.length;
for (const [index, size] of [16, 32].entries()) {
  const png = readFileSync(new URL(`web/favicon-${size}.png`, brand));
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  chunks.push(png);
  offset += png.length;
}
write('web/favicon.ico', Buffer.concat(chunks));

const modes = [light, dark, artwork('tinted')];
write(
  'appearances.png',
  raster(
    svg(modes.map((icon, i) => `<g transform="translate(${1024 * i} 0)">${icon}</g>`).join('\n'), 3072, 1024),
    540,
  ),
);

import { writeFileSync } from 'node:fs';
import { tokens } from './dist/tokens.js';

function properties(group, values) {
  return Object.entries(values)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
      return `  --enduva-${group}-${name}: ${value};`;
    })
    .join('\n');
}

const { colors, ...shared } = tokens;
const scales = Object.entries(shared)
  .map(([group, values]) => properties(group, values))
  .join('\n');
const theme = (mode) => `  color-scheme: ${mode};\n${properties('color', colors[mode])}`;
const css = `:root {
${scales}
}

:root, [data-theme="light"] {
${theme('light')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${theme('dark').replace(/^/gm, '  ')}
  }
}

[data-theme="dark"] {
${theme('dark')}
}
`;
writeFileSync(new URL('./dist/tokens.css', import.meta.url), css);

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const requiredPhrases = [
  '# Rubric Studio Open',
  'docs/demo/rubric-studio-open-30s.gif',
  'git clone https://github.com/auraoneai/rubric-studio-open.git',
  'pnpm --filter=@auraone/rubric-studio-open dev',
  '[Rubric Studio Open docs](docs/README.md)',
  '[local-first privacy and telemetry policy](PRIVACY.md)',
  'Browser editor',
  'Desktop shell',
  'VS Code surface',
  'Open-source boundary',
];

requiredPhrases.forEach((phrase) => {
  assert.ok(readme.includes(phrase), `README.md missing required phrase: ${phrase}`);
});

assert.ok(
  existsSync(join(root, 'docs/demo/rubric-studio-open-30s.gif')),
  'README.md references a missing 30-second demo GIF',
);
assert.ok(existsSync(join(root, 'docs/README.md')), 'README.md references missing docs/README.md');
assert.ok(existsSync(join(root, 'PRIVACY.md')), 'README.md references missing PRIVACY.md');
assert.ok(!readme.includes('TODO'), 'README.md must not contain TODO placeholders');

console.log('Rubric Studio Open README contract passed.');

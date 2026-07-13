import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const requiredPhrases = [
  '# Rubric Studio Open',
  'https://www.auraone.ai/open/rubric-studio-open/screenshots/preview-scoring.webp',
  'https://github.com/gchahal1982/AuraFoundry/blob/main/docs/evidence/final-makeover/assets/open-source-capture-provenance.json',
  'git clone https://github.com/auraoneai/rubric-studio-open.git',
  'pnpm dev',
  '[rubric-studio.auraone.ai](https://rubric-studio.auraone.ai)',
  '[auraone.ai/open/rubric-studio-open](https://auraone.ai/open/rubric-studio-open)',
  '[docs.rubricstudio.auraone.ai](https://docs.rubricstudio.auraone.ai)',
  '[local docs](docs/README.md)',
  '[local-first privacy and telemetry policy](PRIVACY.md)',
  'Browser editor',
  'Desktop shell',
  'VS Code surface',
  'Open-source boundary',
];

requiredPhrases.forEach((phrase) => {
  assert.ok(readme.includes(phrase), `README.md missing required phrase: ${phrase}`);
});

const readmeImages = [...readme.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].map(
  ([, source]) => source,
);
assert.deepEqual(
  readmeImages,
  ['https://www.auraone.ai/open/rubric-studio-open/screenshots/preview-scoring.webp'],
  'README.md must use exactly one representative scoring image',
);
assert.ok(
  !readme.includes('docs/demo/screenshots/') &&
    !readme.includes('docs/demo/rubric-studio-open-30s.gif'),
  'README.md must not reintroduce a screenshot collage or autoplay demo GIF',
);
for (const asset of ['docs/demo/rubric-studio-open-launch-smoke.mp4']) {
  assert.ok(existsSync(join(root, asset)), `Missing launch QA asset: ${asset}`);
}
assert.ok(existsSync(join(root, 'docs/README.md')), 'README.md references missing docs/README.md');
assert.ok(existsSync(join(root, 'PRIVACY.md')), 'README.md references missing PRIVACY.md');
assert.ok(!readme.includes('TODO'), 'README.md must not contain TODO placeholders');

console.log('Rubric Studio Open README contract passed.');

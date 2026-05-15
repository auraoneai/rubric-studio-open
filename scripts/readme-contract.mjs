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
  'pnpm dev',
  '[rubric-studio.auraone.ai](https://rubric-studio.auraone.ai)',
  '[auraone.ai/open/rubric-studio-open](https://auraone.ai/open/rubric-studio-open)',
  '[docs.rubricstudio.auraone.ai](https://docs.rubricstudio.auraone.ai)',
  '[local docs](docs/README.md)',
  '[authoring](docs/demo/screenshots/01-authoring.png)',
  '[preview scoring](docs/demo/screenshots/02-preview-scoring.png)',
  '[calibration](docs/demo/screenshots/03-calibration.png)',
  '[diff](docs/demo/screenshots/04-diff.png)',
  '[export](docs/demo/screenshots/05-export.png)',
  '[short workflow video](docs/demo/rubric-studio-open-launch-smoke.mp4)',
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
for (const asset of [
  'docs/demo/screenshots/01-authoring.png',
  'docs/demo/screenshots/02-preview-scoring.png',
  'docs/demo/screenshots/03-calibration.png',
  'docs/demo/screenshots/04-diff.png',
  'docs/demo/screenshots/05-export.png',
  'docs/demo/rubric-studio-open-launch-smoke.mp4',
]) {
  assert.ok(existsSync(join(root, asset)), `README.md references missing launch QA asset: ${asset}`);
}
assert.ok(existsSync(join(root, 'docs/README.md')), 'README.md references missing docs/README.md');
assert.ok(existsSync(join(root, 'PRIVACY.md')), 'README.md references missing PRIVACY.md');
assert.ok(!readme.includes('TODO'), 'README.md must not contain TODO placeholders');

console.log('Rubric Studio Open README contract passed.');

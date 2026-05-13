import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const privacy = readFileSync(join(root, 'PRIVACY.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const reliability = readFileSync(join(root, 'src/domain/reliability.ts'), 'utf8');
const keychain = readFileSync(join(root, 'src/domain/keychain.ts'), 'utf8');
const engine = readFileSync(join(root, 'src/domain/engine.ts'), 'utf8');

[
  'Browser Edition',
  'Desktop Edition',
  'Telemetry',
  'Crash Reporting',
  'Updates',
  'AuraOne Intake Export',
  'Local Provider Calls',
].forEach((heading) => {
  assert.ok(privacy.includes(`## ${heading}`), `PRIVACY.md must cover ${heading}`);
});

[
  'Telemetry is off by default',
  'Crash reporting is off by default',
  'must not include rubric content',
  'never includes provider API keys',
  'session memory',
  'OS keychain bridge',
  'localhost:11434',
].forEach((phrase) => {
  assert.ok(privacy.includes(phrase), `PRIVACY.md missing required privacy phrase: ${phrase}`);
});

assert.ok(readme.includes('PRIVACY.md'), 'README must link to the package privacy policy');
assert.ok(reliability.includes('sends_user_authored_content: false'));
assert.ok(keychain.includes('byo-api-keys'));
assert.ok(engine.includes('sends_api_keys: false'));
assert.ok(!privacy.includes('TODO'));

console.log('Rubric Studio Open privacy contract passed.');

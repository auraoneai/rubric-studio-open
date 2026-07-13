import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const privacy = readFileSync(join(root, 'PRIVACY.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const reliability = readFileSync(join(root, 'src/domain/reliability.ts'), 'utf8');
const keychain = readFileSync(join(root, 'src/domain/keychain.ts'), 'utf8');
const nativeKeychain = readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8');
const engine = readFileSync(join(root, 'src/domain/engine.ts'), 'utf8');
const platformTelemetry = readFileSync(join(root, 'src/domain/platformTelemetry.ts'), 'utf8');
const settings = readFileSync(join(root, 'src/components/SettingsPanel.tsx'), 'utf8');
const telemetryDocs = readFileSync(join(root, 'docs/telemetry.md'), 'utf8');

[
  'Browser Edition',
  'Desktop Edition',
  'Telemetry',
  'Crash Reporting',
  'Updates',
  'Local Evidence Export',
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
assert.ok(keychain.includes('intakeInstallSigningKeypairKey'));
assert.ok(nativeKeychain.includes('intake-install-signing-key'));
assert.ok(nativeKeychain.includes('ed25519-install-keypair-v1'));
assert.ok(engine.includes('sends_api_keys: false'));
assert.ok(platformTelemetry.includes('type TelemetryLogStatus'));
assert.ok(platformTelemetry.includes('optedIn: entry.status === "local_preview"'));
assert.ok(platformTelemetry.includes('destination: "local"'));
assert.ok(platformTelemetry.includes('deliveryStatus: entry.status'));
assert.ok(!platformTelemetry.includes('destination: "telemetry"'));
assert.ok(settings.includes('Local preview, not sent'));
assert.ok(settings.includes('No telemetry uploader is configured in this build.'));
assert.ok(telemetryDocs.includes('Neither status means an event was'));
assert.ok(!privacy.includes('TODO'));

console.log('Rubric Studio Open privacy contract passed.');

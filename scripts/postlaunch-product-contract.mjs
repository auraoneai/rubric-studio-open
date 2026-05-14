import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const selfTest = read('src/domain/self-test.ts');
const settingsPanel = read('src/components/SettingsPanel.tsx');
const calibrationPanel = read('src/components/CalibrationPanel.tsx');
const diffPanel = read('src/components/DiffPanel.tsx');
const pluginMarketplace = read('src/domain/pluginMarketplace.ts');
const collaboration = read('src/domain/collaboration.ts');
const i18n = read('src/domain/i18n.ts');
const advancedCalibration = read('src/domain/advancedCalibration.ts');
const advancedDiff = read('src/domain/advancedDiff.ts');
const browserSmoke = read('scripts/browser-smoke.mjs');

assert.ok(packageJson.scripts['test:postlaunch'], 'package scripts must expose the post-launch product contract');
assert.ok(
  packageJson.scripts['test:product'].includes('test:postlaunch'),
  'full product suite must include post-launch product contract coverage',
);

assert.ok(pluginMarketplace.includes('enginePluginCatalog'), 'engine plugin catalog domain model is required');
assert.ok(pluginMarketplace.includes('reviewEnginePluginManifest'), 'local plugin manifest review is required');
assert.ok(pluginMarketplace.includes('safeExamplePluginManifest'), 'safe local plugin example is required');
assert.ok(pluginMarketplace.includes("runtime: 'wasm'"), 'browser-compatible WASM plugin runtime must be represented');
assert.ok(pluginMarketplace.includes("networkAccess: 'none'"), 'offline plugin policy must be represented');
assert.ok(pluginMarketplace.includes('unsignedCode'), 'unsafe unsigned plugin handling must be represented');
assert.ok(settingsPanel.includes('Engine plugin catalog'), 'Settings must expose the plugin marketplace');
assert.ok(settingsPanel.includes('Review local plugin manifest'), 'Settings must expose local manifest review');
assert.ok(settingsPanel.includes('Load safe example'), 'Settings must expose a safe manifest example');
assert.ok(browserSmoke.includes('community-safe-adapter'), 'browser smoke must verify safe local plugin import');
assert.ok(selfTest.includes('reviewEnginePluginManifest'), 'domain self-test must cover local plugin manifest review');

assert.ok(collaboration.includes("schema: 'auraone.rubric-studio-open.crdt-snapshot.v1'"), 'CRDT snapshot schema is required');
assert.ok(collaboration.includes("mode: 'read-only'"), 'CRDT collaboration must remain read-only for OSS launch');
assert.ok(collaboration.includes('summarizeReadOnlyCrdtSnapshot'), 'CRDT snapshot summary is required');
assert.ok(diffPanel.includes('Read-only CRDT collaboration'), 'Diff panel must expose read-only collaboration review');
assert.ok(selfTest.includes('buildReadOnlyCrdtSnapshot'), 'domain self-test must cover CRDT snapshots');

for (const locale of ['en', 'es', 'zh', 'ja']) {
  assert.ok(i18n.includes(`code: '${locale}'`), `i18n must support ${locale}`);
}
assert.ok(i18n.includes('StudioMessages'), 'i18n messages must have a typed shape');
assert.ok(settingsPanel.includes('messages.interfaceLanguage'), 'Settings must expose interface language copy');
assert.ok(settingsPanel.includes('locale-row'), 'Settings must expose interface language control');
assert.ok(selfTest.includes('supportedLocales'), 'domain self-test must cover supported locales');

assert.ok(advancedCalibration.includes('hierarchicalAlpha'), 'advanced calibration must compute hierarchical IAA');
assert.ok(advancedCalibration.includes('latentClasses'), 'advanced calibration must compute latent classes');
assert.ok(advancedCalibration.includes('buildCriterionRewriteSuggestions'), 'advanced calibration must generate rewrite suggestions');
assert.ok(calibrationPanel.includes('Advanced calibration'), 'Calibration panel must expose advanced calibration UI');
assert.ok(calibrationPanel.includes('Latent class analysis'), 'Calibration panel must expose latent class analysis');
assert.ok(selfTest.includes('calculateAdvancedCalibration'), 'domain self-test must cover advanced calibration');

assert.ok(advancedDiff.includes('calculateVariantAbTest'), 'advanced diff must calculate variant A/B tests');
assert.ok(advancedDiff.includes('liveJudgeFleet'), 'advanced diff must evaluate an enabled judge fleet');
assert.ok(diffPanel.includes('Live judge fleet A/B test'), 'Diff panel must expose live judge fleet A/B UI');
assert.ok(selfTest.includes('calculateVariantAbTest'), 'domain self-test must cover advanced diff');

console.log('Rubric Studio Open post-launch product contract passed.');

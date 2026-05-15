import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const previewPanel = read('src/components/PreviewPanel.tsx');
const calibrationPanel = read('src/components/CalibrationPanel.tsx');
const diffPanel = read('src/components/DiffPanel.tsx');
const settingsPanel = read('src/components/SettingsPanel.tsx');
const projectSidebar = read('src/components/ProjectSidebar.tsx');
const readme = read('README.md');
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
const browserSmoke = read('scripts/browser-smoke.mjs');

assert.ok(packageJson.scripts['test:postlaunch'], 'package scripts must expose the post-launch product contract');
assert.ok(
  packageJson.scripts['test:product'].includes('test:postlaunch'),
  'full product suite must include post-launch product contract coverage',
);

assert.ok(app.includes("useState<Tab>('authoring')"), 'app must launch directly into the real authoring IDE');
assert.ok(app.includes('setWizardOpen(true)'), 'guided onboarding must remain available without blocking launch');
assert.ok(app.includes('recordTelemetryEvent'), 'launch-ready controls must record transparent feature telemetry');

assert.ok(previewPanel.includes('Load JSONL'), 'Preview must expose JSONL sample import');
assert.ok(previewPanel.includes('Generate synthetic'), 'Preview must expose synthetic sample generation');
assert.ok(previewPanel.includes('Score all'), 'Preview must expose score-all execution');
assert.ok(previewPanel.includes('Score current'), 'Preview must expose current-sample scoring');
assert.ok(calibrationPanel.includes('Load gold JSONL'), 'Calibration must expose gold JSONL import');
assert.ok(diffPanel.includes('fetchRemote'), 'Diff must expose remote fetch action');
assert.ok(diffPanel.includes('commit()'), 'Diff must expose local commit action');

assert.ok(settingsPanel.includes('Provider keys'), 'Settings must include provider-key configuration');
assert.ok(settingsPanel.includes('Theme & contrast'), 'Settings must include theme and contrast controls');
assert.ok(settingsPanel.includes('Telemetry'), 'Settings must include transparent telemetry controls');
assert.ok(settingsPanel.includes('Network'), 'Settings must include no-network controls');
assert.ok(settingsPanel.includes('Shortcuts'), 'Settings must include shortcut controls');
assert.ok(app.includes('AuraOne <span>· Rubric Studio</span>'), 'App chrome must use the AuraOne / Rubric Studio brand');
assert.ok(projectSidebar.includes('Rubric Studio Open'), 'Sidebar must keep readable product context');

assert.ok(tauriConfig.bundle.icon.includes('icons/32x32.png'), 'Tauri bundle must include 32px icon');
assert.ok(tauriConfig.bundle.icon.includes('icons/128x128.png'), 'Tauri bundle must include 128px icon');
assert.ok(tauriConfig.bundle.icon.includes('icons/128x128@2x.png'), 'Tauri bundle must include 256px icon');
assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'), 'Tauri bundle must include native macOS icon');
assert.ok(tauriConfig.bundle.icon.includes('icons/icon.ico'), 'Tauri bundle must include Windows icon');
assert.ok(tauriConfig.bundle.icon.includes('icons/icon.png'), 'Tauri bundle must include web PNG icon');

assert.ok(readme.includes('rubric-studio-open-launch-smoke.mp4'), 'README must include the launch smoke video');
assert.ok(readme.includes('rubric-studio.auraone.ai'), 'README must point to the browser IDE');
assert.ok(readme.includes('docs.rubricstudio.auraone.ai'), 'README must point to docs');
assert.ok(browserSmoke.includes('mainOverflowY'), 'browser smoke must verify fixed desktop shell behavior');
assert.ok(browserSmoke.includes('bodyScrollY'), 'browser smoke must verify body scroll stays locked');

console.log('Rubric Studio Open post-launch product contract passed.');

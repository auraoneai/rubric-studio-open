import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const cargoToml = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/tauri-cross-platform.yml'), 'utf8');

const requiredScripts = [
  'build',
  'test:e2e',
  'test:a11y',
  'test:product',
  'tauri:e2e',
  'tauri:check',
  'tauri:core:test',
  'tauri:build:ci',
  'tauri:build:mac:debug',
];

requiredScripts.forEach((scriptName) => {
  assert.ok(packageJson.scripts[scriptName], `missing package script ${scriptName}`);
});

assert.equal(packageJson.devDependencies['@tauri-apps/cli'], '2.11.1');
assert.equal(tauriConfig.productName, 'Rubric Studio Open');
assert.equal(tauriConfig.identifier, 'ai.auraone.rubricstudio.open');
assert.equal(tauriConfig.build.frontendDist, '../dist');
assert.ok(tauriConfig.app.windows[0].minWidth >= 1024, 'desktop shell must preserve the 1024px functional layout');
assert.deepEqual(tauriConfig.bundle.targets, ['dmg', 'msi', 'appimage', 'deb', 'rpm']);
assert.ok(
  tauriConfig.bundle.icon.every((iconPath) => existsSync(join(root, 'src-tauri', iconPath))),
  'every Tauri bundle icon must exist',
);
assert.ok(cargoToml.includes('tauri-runtime = ["tauri", "tauri-plugin-updater"]'));
assert.ok(workflow.includes('macos-latest'), 'cross-platform Tauri workflow must include macOS');
assert.ok(workflow.includes('windows-latest'), 'cross-platform Tauri workflow must include Windows');
assert.ok(workflow.includes('ubuntu-22.04'), 'cross-platform Tauri workflow must include Linux');
assert.ok(workflow.includes('tauri:build:ci'), 'cross-platform workflow must run the shared Tauri CI build script');
assert.ok(workflow.includes('tauri:e2e:preflight'), 'cross-platform workflow must run the native e2e preflight');
assert.ok(workflow.includes('playwright install chromium'), 'cross-platform workflow must install the browser e2e runtime');
assert.ok(workflow.includes('pnpm test:product'), 'cross-platform workflow must run product/browser/vscode gates');
assert.ok(workflow.includes('cargo install tauri-driver'), 'cross-platform workflow must install tauri-driver');
assert.ok(workflow.includes('pnpm tauri:e2e'), 'cross-platform workflow must run native e2e on supported runners');
assert.ok(existsSync(join(root, 'scripts/tauri-native-smoke.mjs')), 'native Tauri e2e smoke runner is required');

const tauriVersion = runCommand('pnpm', ['exec', 'tauri', '--version']);

const driverProbe = spawnSync('tauri-driver', ['--help'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const driverOutput = `${driverProbe.stdout ?? ''}${driverProbe.stderr ?? ''}`.trim();
const webdriverSupported = driverProbe.status === 0;
const webdriverBlockedReason = webdriverSupported ? null : driverOutput || 'tauri-driver unavailable';

const result = {
  tauri_cli: tauriVersion,
  tauri_driver_installed: driverProbe.error?.code !== 'ENOENT',
  webdriver_supported: webdriverSupported,
  webdriver_blocked_reason: webdriverBlockedReason,
  native_e2e_command: 'pnpm tauri:e2e',
  local_preflight: 'passed',
};

console.log(JSON.stringify(result, null, 2));

if (process.argv.includes('--require-driver') && !webdriverSupported) {
  throw new Error(`Tauri native e2e requires a supported tauri-driver WebDriver backend: ${webdriverBlockedReason}`);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${output || result.error?.message || 'unknown error'}`);
  }
  return result.stdout.trim();
}

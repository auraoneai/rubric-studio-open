import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const webviewChromeSource = appSource;
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8');
const redesign = readFileSync(join(root, 'src/redesign.css'), 'utf8');
const mainSource = readFileSync(join(root, 'src/main.tsx'), 'utf8');
const releaseSource = readFileSync(join(root, 'src/domain/releaseManifest.ts'), 'utf8');
const vscodeSource = readFileSync(join(root, 'vscode-extension/src/extension.ts'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));

assert.equal(packageJson.dependencies['lucide-react'], '0.554.0');
assert.ok(webviewChromeSource.includes("from 'lucide-react'"), 'webview must import lucide-react icons');
assert.ok(appSource.includes('const tabIcons'), 'bottom navigation tabs must use the shared icon registry');
assert.ok(webviewChromeSource.includes('aria-hidden="true"'), 'decorative icons must stay out of the accessible name');
assert.ok(styles.includes('.button-icon'), 'shared icon sizing CSS is required for visual consistency');
assert.ok(mainSource.includes("import '@auraone/proofline-oss/styles.css'"), 'Rubric Studio must import Proofline styles');
assert.ok(mainSource.includes("import '@auraone/aura-ide-kit/styles.css'"), 'Rubric Studio must import Aura IDE Kit styles');
assert.ok(!mainSource.includes('reference-fonts.css'), 'private/reference font bundles must not load');
assert.ok(!existsSync(join(root, 'src/reference-fonts.css')), 'private/reference font bundle must be removed');
assert.ok(redesign.includes('--rs-paper: var(--pl-canvas)'), 'Rubric compatibility tokens must map to Proofline semantics');
assert.ok(!/(^|\n)\s*--pl-[\w-]+\s*:/.test(`${styles}\n${redesign}`), 'local CSS must not redefine Proofline semantic tokens');
assert.ok(!/font-size:\s*(?:9|10|11)px/.test(`${styles}\n${redesign}`), 'visible CSS text must not use 9-11px sizes');
assert.ok(!/text-transform:\s*uppercase/.test(`${styles}\n${redesign}`), 'ordinary UI labels must not be forced uppercase');
assert.ok(!/(?:linear|radial|conic)-gradient|backdrop-filter/.test(`${styles}\n${redesign}`), 'Rubric UI must not use gradients or glass effects');
assert.ok(!/glass-|intake-button|rs-intake-flow/.test(`${styles}\n${redesign}\n${appSource}`), 'legacy glass and intake class names must be removed');
assert.ok(redesign.includes('@media (max-width: 639px)'), 'Proofline compact mobile breakpoint is required');
assert.ok(redesign.includes('min-height: var(--pl-control-mobile)'), 'mobile controls must use the 44px Proofline target');
assert.ok(!appSource.includes('releases/download/v0.1.0'), 'hosted preview must not hard-code a release artifact');
assert.ok(releaseSource.includes('release-manifest.json'), 'hosted preview must consume release metadata');
assert.ok(releaseSource.includes('artifact.verified'), 'hosted preview must require verified artifacts');
assert.ok(!vscodeSource.includes('linear-gradient'), 'VS Code webview must not use decorative gradients');
assert.ok(vscodeSource.includes('--pl-canvas: #f5f7fa'), 'VS Code webview must use Proofline semantic values');
assert.ok(html.includes('rel="icon" href="/favicon.ico"'), 'browser edition must expose the ICO favicon');
assert.ok(html.includes('rel="icon" href="/favicon.svg"'), 'browser edition must expose the SVG favicon');
assert.ok(html.includes('boot-splash'), 'app shell must include a first-paint splash screen');
assert.ok(html.includes('role="status"'), 'first-paint splash must expose status semantics');
assert.ok(html.includes('aria-live="polite"'), 'first-paint splash status must be polite for assistive tech');
assert.ok(existsSync(join(root, 'assets/brand/logo.svg')), 'brand logo SVG is required');
assert.ok(existsSync(join(root, 'assets/brand/splash.svg')), 'brand splash SVG is required');
assert.ok(existsSync(join(root, 'assets/brand/splash-1920x1080.png')), 'rendered splash PNG is required');
assert.ok(existsSync(join(root, 'public/favicon.ico')), 'browser ICO favicon is required');
assert.ok(existsSync(join(root, 'public/favicon.svg')), 'browser SVG favicon is required');
assert.ok(existsSync(join(root, 'src-tauri/icons/icon.icns')), 'macOS app icon bundle is required');
assert.ok(existsSync(join(root, 'src-tauri/icons/icon.ico')), 'Windows app icon bundle is required');
assert.ok(readFileSync(join(root, 'assets/brand/logo.svg'), 'utf8').includes('<svg'), 'brand logo must be SVG');
assert.ok(readFileSync(join(root, 'assets/brand/splash.svg'), 'utf8').includes('<svg'), 'brand splash source must be SVG');
assert.ok(readFileSync(join(root, 'public/favicon.svg'), 'utf8').includes('<svg'), 'browser favicon SVG must be valid SVG text');
assert.deepEqual(tauriConfig.bundle.icon, [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
  'icons/icon.png',
]);

const expectedIconSizes = new Map([
  ['32x32.png', [32, 32]],
  ['128x128.png', [128, 128]],
  ['128x128@2x.png', [256, 256]],
  ['icon.png', [1024, 1024]],
]);

assert.deepEqual(
  pngDimensions(join(root, 'assets/brand/splash-1920x1080.png')),
  { width: 1920, height: 1080 },
  'rendered splash PNG must be 1920x1080',
);

expectedIconSizes.forEach(([width, height], filename) => {
  assert.deepEqual(
    pngDimensions(join(root, `src-tauri/icons/${filename}`)),
    { width, height },
    `${filename} must be rendered at ${width}x${height}`,
  );
});

assert.deepEqual(
  icoSizes(join(root, 'src-tauri/icons/icon.ico')),
  [
    [16, 16],
    [32, 32],
    [48, 48],
    [256, 256],
  ],
  'Windows app ICO must include 16, 32, 48, and 256px entries',
);
assert.deepEqual(
  icoSizes(join(root, 'public/favicon.ico')),
  [
    [16, 16],
    [32, 32],
    [48, 48],
    [256, 256],
  ],
  'Browser ICO favicon must include 16, 32, 48, and 256px entries',
);
assert.deepEqual(
  icnsTypes(join(root, 'src-tauri/icons/icon.icns')),
  ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14', 'info'],
  'macOS ICNS must include retina and standard icon entries',
);

const requiredIcons = [
  'FileText',
  'SquarePen',
  'Play',
  'Command',
  'FileDiff',
  'Settings',
];

requiredIcons.forEach((icon) => {
  assert.ok(webviewChromeSource.includes(icon), `${icon} must be represented in Rubric Studio Open webview chrome`);
});

console.log('Rubric Studio Open design contract passed.');

function pngDimensions(path) {
  const png = readFileSync(path);
  assert.equal(png.toString('ascii', 1, 4), 'PNG', `${path} must be a PNG`);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function icoSizes(path) {
  const ico = readFileSync(path);
  assert.equal(ico.readUInt16LE(0), 0, `${path} has invalid ICO reserved header`);
  assert.equal(ico.readUInt16LE(2), 1, `${path} must be an icon resource`);
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = ico[offset] === 0 ? 256 : ico[offset];
    const height = ico[offset + 1] === 0 ? 256 : ico[offset + 1];
    const bitDepth = ico.readUInt16LE(offset + 6);
    assert.equal(bitDepth, 32, `${path} ICO entry ${width}x${height} must be 32-bit`);
    sizes.push([width, height]);
  }
  return sizes;
}

function icnsTypes(path) {
  const icns = readFileSync(path);
  assert.equal(icns.toString('ascii', 0, 4), 'icns', `${path} must be an ICNS bundle`);
  assert.equal(icns.readUInt32BE(4), icns.length, `${path} has an invalid ICNS length header`);
  const types = [];
  let offset = 8;
  while (offset + 8 <= icns.length) {
    const type = icns.toString('ascii', offset, offset + 4);
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `${path} ICNS entry ${type} has invalid length`);
    types.push(type);
    offset += length;
  }
  assert.equal(offset, icns.length, `${path} ICNS entries must consume the full file`);
  return types.sort();
}

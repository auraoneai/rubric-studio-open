import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));

assert.equal(packageJson.dependencies['lucide-react'], '0.554.0');
assert.ok(appSource.includes("from 'lucide-react'"), 'webview must import lucide-react icons');
assert.ok(appSource.includes('const menuIcons'), 'top application menu must use the shared icon registry');
assert.ok(appSource.includes('const tabIcons'), 'bottom navigation tabs must use the shared icon registry');
assert.ok(appSource.includes('aria-hidden="true"'), 'decorative icons must stay out of the accessible name');
assert.ok(styles.includes('.button-icon'), 'shared icon sizing CSS is required for visual consistency');
assert.ok(html.includes('rel="icon" href="/favicon.ico"'), 'browser edition must expose the ICO favicon');
assert.ok(html.includes('rel="icon" href="/favicon.svg"'), 'browser edition must expose the SVG favicon');
assert.ok(html.includes('boot-splash'), 'app shell must include a first-paint splash screen');
assert.ok(existsSync(join(root, 'assets/brand/logo.svg')), 'brand logo SVG is required');
assert.ok(existsSync(join(root, 'assets/brand/splash.svg')), 'brand splash SVG is required');
assert.ok(existsSync(join(root, 'assets/brand/splash-1920x1080.png')), 'rendered splash PNG is required');
assert.ok(existsSync(join(root, 'public/favicon.ico')), 'browser ICO favicon is required');
assert.ok(existsSync(join(root, 'public/favicon.svg')), 'browser SVG favicon is required');
assert.ok(existsSync(join(root, 'src-tauri/icons/icon.icns')), 'macOS app icon bundle is required');
assert.ok(existsSync(join(root, 'src-tauri/icons/icon.ico')), 'Windows app icon bundle is required');
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

expectedIconSizes.forEach(([width, height], filename) => {
  assert.deepEqual(
    pngDimensions(join(root, `src-tauri/icons/${filename}`)),
    { width, height },
    `${filename} must be rendered at ${width}x${height}`,
  );
});

const requiredIcons = [
  'FileText',
  'SquarePen',
  'Eye',
  'BookOpen',
  'Play',
  'Wrench',
  'HelpCircle',
  'Command',
  'GitCompare',
  'Settings',
];

requiredIcons.forEach((icon) => {
  assert.ok(appSource.includes(icon), `${icon} must be represented in Rubric Studio Open webview chrome`);
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

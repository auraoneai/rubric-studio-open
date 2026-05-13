import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const styles = readFileSync(join(root, 'src/styles.css'), 'utf8');

assert.equal(packageJson.dependencies['lucide-react'], '0.554.0');
assert.ok(appSource.includes("from 'lucide-react'"), 'webview must import lucide-react icons');
assert.ok(appSource.includes('const menuIcons'), 'top application menu must use the shared icon registry');
assert.ok(appSource.includes('const tabIcons'), 'bottom navigation tabs must use the shared icon registry');
assert.ok(appSource.includes('aria-hidden="true"'), 'decorative icons must stay out of the accessible name');
assert.ok(styles.includes('.button-icon'), 'shared icon sizing CSS is required for visual consistency');

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

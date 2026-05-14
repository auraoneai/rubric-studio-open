import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(root, 'vscode-extension');
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const distFiles = readdirSync(join(extensionRoot, 'dist')).sort();

assert.deepEqual(distFiles, ['extension.js', 'validator.js']);
assert.ok(existsSync(join(extensionRoot, 'LICENSE')), 'VS Code extension package must include its MIT license.');
assert.deepEqual(manifest.files, ['dist/extension.js', 'dist/validator.js', 'media/**', 'LICENSE']);
assert.ok(!manifest.files.some((entry) => entry.includes('src')), 'VSIX allowlist must not include TypeScript source.');
assert.ok(
  !distFiles.some((entry) => /test/i.test(entry)),
  'VS Code extension build output must not include test files.',
);

console.log('Rubric Studio Open VS Code package contract passed.');

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = readFileSync(join(root, 'vscode-extension/src/extension.ts'), 'utf8');
const webview = readFileSync(join(root, 'vscode-extension/media/webview.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'vscode-extension/package.json'), 'utf8'));

[
  'auraone.rubricStudio.open',
  'auraone.rubricStudio.validate',
  'auraone.rubricStudio.commands',
  'auraone.rubricStudio.exportIntake',
].forEach((command) => {
  assert.ok(
    manifest.contributes.commands.some((entry) => entry.command === command),
    `VS Code manifest must contribute ${command}`,
  );
});

[
  'registerLiveValidation',
  'onDidChangeTextDocument',
  'onDidSaveTextDocument',
  'registerCompletionItemProvider',
  'CompletionItemKind.Field',
  'registerCodeActionsProvider',
  'CodeActionKind.QuickFix',
  'validateCriterionToml',
  'createDiagnosticCollection',
].forEach((phrase) => {
  assert.ok(extension.includes(phrase), `extension.ts must include ${phrase}`);
});

[
  'Validate project',
  'Save current criterion',
  'Prepare intake export',
  'Show browser constraints',
  'Open desktop-only sidecar note',
].forEach((phrase) => {
  assert.ok(webview.includes(phrase) || extension.includes(phrase), `VS Code webview must expose ${phrase}`);
});

assert.ok(
  extension.includes("pattern: '**/criteria/**/*.toml'"),
  'VS Code extension must target rubric criterion TOML files',
);
assert.ok(
  extension.includes('Content-Security-Policy') && extension.includes("default-src 'none'"),
  'VS Code webview must ship a locked CSP',
);
assert.equal(manifest.engines.vscode, '^1.92.0');

console.log('Rubric Studio Open VS Code extension contract passed.');

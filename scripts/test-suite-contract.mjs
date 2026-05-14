import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const workflow = readFileSync(join(root, '.github/workflows/tauri-cross-platform.yml'), 'utf8');
const preflight = readFileSync(join(root, 'scripts/tauri-e2e-preflight.mjs'), 'utf8');

const scripts = packageJson.scripts;

assert.equal(scripts['test:unit:ts'], 'tsx src/domain/self-test.ts', 'TS unit suite must run the domain self-test directly');
assert.equal(
  scripts['test:unit:rust'],
  'cargo test --manifest-path src-tauri/Cargo.toml',
  'Rust unit suite must run the Tauri core tests directly',
);
assert.equal(scripts['test:snapshot'], 'tsx src/domain/snapshot-test.ts', 'snapshot regression suite must be explicit');
assert.equal(scripts['test:perf'], 'tsx src/domain/performance-test.ts', 'validator/diff performance suite must be explicit');
assert.ok(scripts['test:regression'].includes('test:snapshot'), 'regression suite must include snapshot tests');
assert.ok(scripts['test:regression'].includes('test:perf'), 'regression suite must include performance tests');
assert.ok(scripts['test:desktop'].includes('tauri:core:test'), 'desktop suite must include Rust unit tests');
assert.ok(scripts['test:desktop'].includes('tauri:check'), 'desktop suite must include Tauri runtime checking');
assert.ok(scripts['test:desktop'].includes('tauri:build:ci'), 'desktop suite must include a Tauri app build');
assert.ok(scripts['test:desktop'].includes('tauri:e2e:preflight'), 'desktop suite must include Tauri e2e preflight');
assert.ok(scripts['test:product'].includes('test:unit:ts'), 'product suite must include TS unit tests');
assert.ok(scripts['test:product'].includes('test:desktop'), 'product suite must include desktop/Tauri tests');
assert.ok(scripts['test:product'].includes('test:suite'), 'product suite must include this suite coverage contract');
assert.ok(scripts['test:product'].includes('test:e2e'), 'product suite must include browser Playwright e2e');
assert.ok(scripts['test:product'].includes('test:a11y'), 'product suite must include accessibility smoke');
assert.ok(scripts['test:product'].includes('vscode:typecheck'), 'product suite must include VS Code surface typecheck');
assert.ok(preflight.includes("'test:desktop'"), 'Tauri preflight must require the desktop test script');
assert.ok(workflow.includes('pnpm test:product'), 'cross-platform workflow must run the product suite');
assert.ok(workflow.includes('pnpm tauri:e2e'), 'cross-platform workflow must expose native Tauri e2e');
assert.ok(workflow.includes('windows-2022'), 'native Tauri e2e must have a supported Windows WebDriver runner');

console.log('Rubric Studio Open test-suite contract passed.');

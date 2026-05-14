import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

for (const file of [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/support_request.yml',
  '.github/ISSUE_TEMPLATE/rfc.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/CODEOWNERS',
  '.github/workflows/dco.yml',
  '.github/dependabot.yml',
]) {
  assert.ok(existsSync(join(root, file)), `${file} is required`);
}

const pullRequest = read('.github/PULL_REQUEST_TEMPLATE.md');
for (const phrase of [
  'Security And Privacy',
  'Tauri CSP',
  '.auraonepkg',
  'DCO',
  'Signed-off-by',
]) {
  assert.ok(pullRequest.includes(phrase), `PR template missing ${phrase}`);
}

const bugReport = read('.github/ISSUE_TEMPLATE/bug_report.yml');
for (const phrase of [
  'Do not report security vulnerabilities here',
  'security@auraone.ai',
  'Privacy check',
  'private samples',
]) {
  assert.ok(bugReport.includes(phrase), `bug template missing ${phrase}`);
}

const featureRequest = read('.github/ISSUE_TEMPLATE/feature_request.yml');
for (const phrase of [
  'RFC triggers',
  'rubric-spec',
  'engine-library integration',
  'telemetry',
]) {
  assert.ok(featureRequest.includes(phrase), `feature template missing ${phrase}`);
}

const supportRequest = read('.github/ISSUE_TEMPLATE/support_request.yml');
for (const phrase of [
  'reproducible OSS support',
  'AuraOne intake export',
  'VS Code extension',
  'Privacy check',
]) {
  assert.ok(supportRequest.includes(phrase), `support template missing ${phrase}`);
}

const config = read('.github/ISSUE_TEMPLATE/config.yml');
assert.ok(config.includes('blank_issues_enabled: false'), 'blank issues must be disabled');
assert.ok(config.includes('Security disclosure'), 'security contact link is required');
assert.ok(config.includes('/discussions'), 'discussions contact link is required');

console.log('Rubric Studio Open GitHub template contract passed.');

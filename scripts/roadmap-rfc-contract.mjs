import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const roadmapPath = join(root, 'docs/roadmap-rfc.md');
const issueTemplatePath = join(root, '.github/ISSUE_TEMPLATE/rfc.md');
const docsIndex = readFileSync(join(root, 'docs/README.md'), 'utf8');
const governance = readFileSync(join(root, 'GOVERNANCE.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

assert.ok(existsSync(roadmapPath), 'roadmap/RFC document is required');
assert.ok(existsSync(issueTemplatePath), 'RFC issue template is required');

const roadmap = readFileSync(roadmapPath, 'utf8');
const issueTemplate = readFileSync(issueTemplatePath, 'utf8');

[
  'Roadmap Lanes',
  'RFC Triggers',
  'RFC Lifecycle',
  'Initial RFC Backlog',
  'Non-Public Evidence Rules',
  'Plugin marketplace',
  'Read-only CRDT collaboration',
  'Advanced calibration',
  'Live judge-fleet A/B diff',
  'Standards-body rubric-spec submission',
].forEach((phrase) => {
  assert.ok(roadmap.includes(phrase), `roadmap/RFC document missing ${phrase}`);
});

[
  'Project format, schema, export, intake packet, or `rubric-spec`',
  'Engine-library integration',
  'Plugin marketplace or third-party extension behavior',
  'Collaboration, sync, or remote execution',
  'OSS/commercial boundary',
  'Tests And Evidence',
  'Maintainer Decision',
].forEach((phrase) => {
  assert.ok(issueTemplate.includes(phrase), `RFC issue template missing ${phrase}`);
});

assert.ok(docsIndex.includes('roadmap-rfc.md'), 'docs index must link the roadmap/RFC process');
assert.ok(governance.includes('docs/roadmap-rfc.md'), 'governance must link the roadmap/RFC process');
assert.ok(readme.includes('docs/roadmap-rfc.md'), 'README must link the roadmap/RFC process');
assert.ok(!roadmap.includes('TODO'), 'roadmap/RFC document must not contain TODO placeholders');
assert.ok(!issueTemplate.includes('TODO'), 'RFC issue template must not contain TODO placeholders');

console.log('Rubric Studio Open roadmap/RFC contract passed.');

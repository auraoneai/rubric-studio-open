import { strict as assert } from 'node:assert';
import { calculateCalibration, generateExports, scoreSamples, semanticDiff } from './engine';
import { sampleProject } from './rubric';
import { searchProject, validateProject } from './validation';

const issues = validateProject(sampleProject);
assert.ok(issues.some((issue) => issue.severity === 'warning'));

const results = scoreSamples(sampleProject, sampleProject.samples, sampleProject.judges);
assert.ok(results.length >= sampleProject.samples.length * sampleProject.criteria.length);
assert.ok(results.every((result) => result.reasoning.length > 0));

const calibration = calculateCalibration(sampleProject, results);
assert.equal(calibration.length, sampleProject.criteria.length);
assert.ok(calibration.every((item) => Number.isFinite(item.kappa)));

const diff = semanticDiff(sampleProject);
assert.equal(diff.length, sampleProject.criteria.length);

const exports = generateExports(sampleProject, issues, calibration);
assert.ok(exports['rubric.json'].includes('"schema"'));
assert.ok(exports['judge-card.md'].includes('Judge Card'));
assert.ok(exports['.github/workflows/rubric.yml'].includes('rubric validate'));

const search = searchProject(sampleProject, {
  query: 'safety',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
});
assert.ok(search.length > 0);

console.log('Rubric Studio Open domain self-test passed.');

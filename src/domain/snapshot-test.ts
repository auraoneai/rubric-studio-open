import { strict as assert } from 'node:assert';
import { calculateCalibration, distributionForCriterion, generateExports, projectHealth, scoreSamples, semanticDiff } from './engine';
import { sampleProject } from './rubric';
import { validateProject } from './validation';

const issues = validateProject(sampleProject);
const results = scoreSamples(sampleProject, sampleProject.samples, sampleProject.judges);
const calibration = calculateCalibration(sampleProject, results);
const changedProject = {
  ...sampleProject,
  criteria: sampleProject.criteria.map((criterion, index) =>
    index === 0
      ? { ...criterion, weight: 0.4, description: `${criterion.description} Include one safe alternative.` }
      : criterion,
  ),
};
const diff = semanticDiff(changedProject, sampleProject);
const exports = generateExports(sampleProject, issues, calibration);

assert.deepEqual(
  issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
    return counts;
  }, {}),
  { warning: 3 },
);
assert.deepEqual(results[0], {
  criterionId: 'safe-refusal',
  judgeId: 'local-mock',
  sampleId: 'sample-001',
  verdict: 'pass',
  score: 0.79,
  confidence: 0.72,
  reasoning:
    'Deterministic local fixture analysis marked Safe refusal as PASS from the response text: "Contact support from the original email, provide recent billing details, and rotate your password after recovery. I c..."',
});
assert.equal(results.length, 12);
assert.deepEqual(distributionForCriterion(results, 'safe-refusal'), {
  pass: 2,
  partial: 1,
  fail: 0,
});
assert.equal(calibration.length, sampleProject.criteria.length);
assert.ok(calibration.every((item) => Number.isFinite(item.kappa)));
assert.equal(diff.length, 1);
assert.equal(diff[0].criterionId, 'safe-refusal');
assert.equal(diff[0].severity, 'substantive');
assert.deepEqual(diff[0].changedFields.sort(), ['description', 'weight']);
assert.deepEqual(projectHealth(sampleProject), {
  issueCounts: {
    error: 0,
    warning: 3,
    suggestion: 0,
  },
  readiness: 76,
});
assert.ok(exports['rubric.json'].includes('"schema"'));
assert.ok(exports['conformance-badge.svg'].includes('rubric-spec v1 review'));
assert.ok(exports['judge-card.md'].includes('Mean calibration kappa'));
assert.ok(exports['.github/workflows/rubric.yml'].includes('rubric validate'));

console.log('Rubric Studio Open snapshot regression passed.');

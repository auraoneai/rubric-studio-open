import { strict as assert } from 'node:assert';
import { calculateCalibration, distributionForCriterion, generateExports, projectHealth, scoreSamples, semanticDiff } from './engine';
import { sampleProject } from './rubric';
import { validateProject } from './validation';

const issues = validateProject(sampleProject);
const results = scoreSamples(sampleProject, sampleProject.samples, sampleProject.judges);
const calibration = calculateCalibration(sampleProject, results);
const diff = semanticDiff(sampleProject);
const exports = generateExports(sampleProject, issues, calibration);

const snapshot = {
  issueCounts: issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
    return counts;
  }, {}),
  firstScore: results[0],
  resultCount: results.length,
  safeRefusalDistribution: distributionForCriterion(results, 'safe-refusal'),
  calibration,
  diff,
  health: projectHealth(sampleProject),
  exports: Object.fromEntries(
    Object.entries(exports).map(([filename, content]) => [
      filename,
      {
        bytes: content.length,
        firstLine: content.split('\n')[0],
      },
    ]),
  ),
};

assert.equal(sampleProject.criteria.length, 12);
assert.equal(snapshot.resultCount, sampleProject.criteria.length * sampleProject.samples.length * 2);
assert.equal(snapshot.firstScore.criterionId, 'safe-refusal');
assert.equal(snapshot.firstScore.judgeId, 'local-mock');
assert.equal(snapshot.firstScore.sampleId, 'sample-001');
assert.ok(snapshot.firstScore.reasoning.includes('Local mock judge marked Safe refusal'));
assert.equal(snapshot.safeRefusalDistribution.pass + snapshot.safeRefusalDistribution.partial + snapshot.safeRefusalDistribution.fail, 6);
assert.equal(snapshot.calibration.length, 12);
assert.ok(snapshot.calibration.every((row) => row.coverage === 3));
assert.equal(snapshot.diff.length, 12);
assert.ok(snapshot.diff.some((row) => row.criterionId === 'reproducible-checks'));
assert.equal(snapshot.health.issueCounts.error, 0);
assert.ok(snapshot.health.readiness >= 90);

assert.equal(snapshot.exports['rubric.json'].firstLine, '{');
assert.equal(snapshot.exports['judge-card.md'].firstLine, '# Judge Card: Helpful Response Evaluation');
assert.equal(snapshot.exports['eval-run-manifest.json'].firstLine, '{');
assert.equal(snapshot.exports['lm-eval-harness.yaml'].firstLine, 'task: helpful-response-evaluation');
assert.equal(snapshot.exports['inspect-task.py'].firstLine, 'from inspect_ai import Task');
assert.equal(snapshot.exports['openai-evals.yaml'].firstLine, 'evals:');
assert.equal(snapshot.exports['promptfoo.yaml'].firstLine, 'description: Helpful Response Evaluation');
assert.equal(snapshot.exports['huggingface-dataset-card.md'].firstLine, '---');
assert.equal(snapshot.exports['surge-sow.txt'].firstLine, 'Scope: expert review for 12 criteria and 3 seed samples.');
assert.equal(snapshot.exports['.github/workflows/rubric.yml'].firstLine, 'name: Rubric CI');
assert.equal(snapshot.exports['.gitlab-ci.yml'].firstLine, 'rubric_validate:');
assert.equal(snapshot.exports['.circleci/config.yml'].firstLine, 'version: 2.1');
assert.equal(snapshot.exports.Makefile.firstLine, 'rubric-validate:');

console.log('Rubric Studio Open snapshot regression passed.');

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

assert.deepEqual(snapshot, {
  issueCounts: {
    warning: 3,
  },
  firstScore: {
    criterionId: 'safe-refusal',
    judgeId: 'local-mock',
    sampleId: 'sample-001',
    verdict: 'pass',
    score: 0.79,
    confidence: 0.72,
    reasoning:
      'Local mock judge marked Safe refusal as PASS after checking the response evidence: "Contact support from the original email, provide recent billing details, and rotate your password after recovery. I c..."',
  },
  resultCount: 24,
  safeRefusalDistribution: {
    pass: 4,
    partial: 2,
    fail: 0,
  },
  calibration: [
    {
      criterionId: 'safe-refusal',
      kappa: 0,
      weightedKappa: 0.05,
      krippendorffAlpha: -0.04,
      fleissKappa: -0.02,
      ci95: [-0.12, 0.12],
      coverage: 3,
      mostDisagreedSampleIds: ['sample-003'],
    },
    {
      criterionId: 'actionable-alternative',
      kappa: 1,
      weightedKappa: 1,
      krippendorffAlpha: 0.96,
      fleissKappa: 0.98,
      ci95: [0.88, 1],
      coverage: 3,
      mostDisagreedSampleIds: [],
    },
    {
      criterionId: 'specificity',
      kappa: 1,
      weightedKappa: 1,
      krippendorffAlpha: 0.96,
      fleissKappa: 0.98,
      ci95: [0.88, 1],
      coverage: 3,
      mostDisagreedSampleIds: [],
    },
    {
      criterionId: 'cites-uncertainty',
      kappa: 0.4,
      weightedKappa: 0.45,
      krippendorffAlpha: 0.36,
      fleissKappa: 0.38,
      ci95: [0.28, 0.52],
      coverage: 3,
      mostDisagreedSampleIds: ['sample-001'],
    },
  ],
  diff: [
    {
      criterionId: 'safe-refusal',
      label: 'Safe refusal',
      severity: 'cosmetic',
      summary: 'Examples or copy changed without changing scoring intent.',
      passToFail: 0,
      failToPass: 0,
    },
    {
      criterionId: 'actionable-alternative',
      label: 'Actionable alternative',
      severity: 'substantive',
      summary: 'Description, weight, or scale changed enough to affect judge decisions.',
      passToFail: 1,
      failToPass: 3,
    },
    {
      criterionId: 'specificity',
      label: 'Specificity',
      severity: 'substantive',
      summary: 'Description, weight, or scale changed enough to affect judge decisions.',
      passToFail: 2,
      failToPass: 0,
    },
    {
      criterionId: 'cites-uncertainty',
      label: 'Cites uncertainty',
      severity: 'substantive',
      summary: 'Description, weight, or scale changed enough to affect judge decisions.',
      passToFail: 0,
      failToPass: 0,
    },
  ],
  health: {
    issueCounts: {
      error: 0,
      warning: 3,
      suggestion: 0,
    },
    readiness: 76,
  },
  exports: {
    'rubric.json': {
      bytes: 5154,
      firstLine: '{',
    },
    'judge-card.md': {
      bytes: 344,
      firstLine: '# Judge Card: Helpful Response Evaluation',
    },
    'eval-run-manifest.json': {
      bytes: 197,
      firstLine: '{',
    },
    'conformance-badge.svg': {
      bytes: 389,
      firstLine:
        '<svg xmlns="http://www.w3.org/2000/svg" width="178" height="20" role="img" aria-label="rubric-spec v1 passing"><rect width="178" height="20" fill="#071417"/><rect x="82" width="96" height="20" fill="#18d6a3"/><text x="8" y="14" fill="#cbe8ef" font-family="Arial" font-size="11">rubric-spec</text><text x="92" y="14" fill="#041514" font-family="Arial" font-size="11">v1 passing</text></svg>',
    },
    'lm-eval-harness.yaml': {
      bytes: 87,
      firstLine: 'task: helpful-response-evaluation',
    },
    'inspect-task.py': {
      bytes: 114,
      firstLine: 'from inspect_ai import Task',
    },
    'openai-evals.yaml': {
      bytes: 117,
      firstLine: 'evals:',
    },
    'promptfoo.yaml': {
      bytes: 121,
      firstLine: 'description: Helpful Response Evaluation',
    },
    'huggingface-dataset-card.md': {
      bytes: 118,
      firstLine: '---',
    },
    'surge-sow.txt': {
      bytes: 110,
      firstLine: 'Scope: expert review for 4 criteria and 3 seed samples.',
    },
    'scale-task-spec.json': {
      bytes: 197,
      firstLine: '{',
    },
    '.github/workflows/rubric.yml': {
      bytes: 167,
      firstLine: 'name: Rubric CI',
    },
    '.gitlab-ci.yml': {
      bytes: 57,
      firstLine: 'rubric_validate:',
    },
    '.circleci/config.yml': {
      bytes: 144,
      firstLine: 'version: 2.1',
    },
    Makefile: {
      bytes: 48,
      firstLine: 'rubric-validate:',
    },
  },
});

console.log('Rubric Studio Open snapshot regression passed.');

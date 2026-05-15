import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { semanticDiff } from './engine';
import { sampleProject } from './rubric';
import { searchProject, validateProject } from './validation';

const VALIDATOR_SAMPLE_COUNT = 10_000;
const DIFF_CRITERION_COUNT = 5_000;
const SEARCH_CRITERION_COUNT = 2_500;

const validatorProject = {
  ...sampleProject,
  samples: Array.from({ length: VALIDATOR_SAMPLE_COUNT }, (_, index) => ({
    ...sampleProject.samples[index % sampleProject.samples.length],
    id: `perf-sample-${index}`,
  })),
};

const validatorStart = performance.now();
const issues = validateProject(validatorProject);
const validatorMs = performance.now() - validatorStart;
assert.ok(issues.length > 0);
assert.ok(
  validatorMs < 40,
  `validator exceeded local ${VALIDATOR_SAMPLE_COUNT.toLocaleString()}-sample budget: ${validatorMs.toFixed(2)}ms`,
);

const diffProject = {
  ...sampleProject,
  criteria: Array.from({ length: DIFF_CRITERION_COUNT }, (_, index) => ({
    ...sampleProject.criteria[index % sampleProject.criteria.length],
    id: `${sampleProject.criteria[index % sampleProject.criteria.length].id}-${index}`,
  })),
};

const diffStart = performance.now();
const diff = semanticDiff(diffProject);
const diffMs = performance.now() - diffStart;
assert.equal(diff.length, DIFF_CRITERION_COUNT);
assert.ok(
  diffMs < 120,
  `semantic diff exceeded local ${DIFF_CRITERION_COUNT.toLocaleString()}-criterion budget: ${diffMs.toFixed(2)}ms`,
);

const searchProjectFixture = {
  ...sampleProject,
  criteria: Array.from({ length: SEARCH_CRITERION_COUNT }, (_, index) => ({
    ...sampleProject.criteria[index % sampleProject.criteria.length],
    id: `search-criterion-${index}`,
  })),
};

const searchStart = performance.now();
const searchResults = searchProject(searchProjectFixture, {
  query: 'safety',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
});
const searchMs = performance.now() - searchStart;
assert.ok(searchResults.length > 0);
assert.ok(
  searchMs < 80,
  `project search exceeded local ${SEARCH_CRITERION_COUNT.toLocaleString()}-criterion budget: ${searchMs.toFixed(2)}ms`,
);

console.log(
  `Rubric Studio Open performance regression passed: validator ${validatorMs.toFixed(2)}ms, diff ${diffMs.toFixed(
    2,
  )}ms, search ${searchMs.toFixed(2)}ms.`,
);

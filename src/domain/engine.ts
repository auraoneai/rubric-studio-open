import type {
  CalibrationResult,
  Criterion,
  DiffResult,
  JudgeConfig,
  RubricProject,
  RubricSample,
  ScoreResult,
  TelemetryEvent,
  ValidationIssue,
} from './rubric';
import { validateProject } from './validation';

const CRITERION_FIELDS: Array<keyof Criterion> = [
  'id',
  'label',
  'themeId',
  'description',
  'weight',
  'scale',
  'positiveExamples',
  'negativeExamples',
  'antiPatterns',
  'boundaries',
  'edgeCases',
  'evidenceRequirement',
  'tags',
  'references',
  'siblingLinks',
  'status',
  'comments',
];
const BREAKING_DIFF_FIELDS = new Set(['scale', 'status', 'evidenceRequirement']);
const SUBSTANTIVE_DIFF_FIELDS = new Set([
  'description',
  'weight',
  'positiveExamples',
  'negativeExamples',
  'boundaries',
]);
const LOCAL_SCORE_INPUT_FIELDS = new Set(['positiveExamples', 'negativeExamples', 'tags']);

export function scoreSamples(
  project: RubricProject,
  samples: RubricSample[],
  judges: JudgeConfig[],
): ScoreResult[] {
  const enabledJudges = judges.filter((judge) => judge.enabled && judge.provider === 'mock');
  return samples.flatMap((sample) =>
    enabledJudges.flatMap((judge) =>
      project.criteria.map((criterion) => scoreCriterion(criterion, sample, judge)),
    ),
  );
}

export function scoreCriterion(
  criterion: Criterion,
  sample: RubricSample,
  judge: JudgeConfig,
): ScoreResult {
  if (judge.provider !== 'mock') {
    throw new Error('Deterministic local fixture scoring only supports mock judges.');
  }
  const hash = stableHash(`${criterion.id}:${sample.id}:${judge.id}:${sample.response}`);
  const sampleText = `${sample.prompt} ${sample.response}`.toLowerCase();
  const score = localFixtureScore(criterion, sampleText, hash);
  const verdict = verdictForScore(score);

  return {
    criterionId: criterion.id,
    judgeId: judge.id,
    sampleId: sample.id,
    verdict,
    score: Number(score.toFixed(2)),
    confidence: Number((0.62 + (hash % 31) / 100).toFixed(2)),
    reasoning: buildReasoning(criterion, sample, judge, verdict),
  };
}

function localFixtureScore(criterion: Criterion, sampleText: string, hash: number): number {
  const positiveHits = criterion.positiveExamples.filter((example) =>
    hasSharedToken(sampleText, example),
  ).length;
  const negativeHits = criterion.negativeExamples.filter((example) =>
    hasSharedToken(sampleText, example),
  ).length;
  const tagBonus = criterion.tags.some((tag) => sampleText.includes(tag.split(':').pop() ?? ''))
    ? 0.12
    : 0;
  const score = clamp(
    0.42 + positiveHits * 0.18 - negativeHits * 0.16 + tagBonus + (hash % 23) / 100,
    0,
    1,
  );
  return score;
}

function verdictForScore(score: number): ScoreResult['verdict'] {
  return score >= 0.67 ? 'pass' : score >= 0.4 ? 'partial' : 'fail';
}

export function summarizeCatchView(results: ScoreResult[]): Record<string, ScoreResult[]> {
  return results.reduce<Record<string, ScoreResult[]>>((byCriterion, result) => {
    byCriterion[result.criterionId] = byCriterion[result.criterionId] ?? [];
    byCriterion[result.criterionId].push(result);
    return byCriterion;
  }, {});
}

export function distributionForCriterion(results: ScoreResult[], criterionId: string): {
  pass: number;
  partial: number;
  fail: number;
} {
  return results
    .filter((result) => result.criterionId === criterionId)
    .reduce(
      (counts, result) => {
        counts[result.verdict] += 1;
        return counts;
      },
      { pass: 0, partial: 0, fail: 0 },
    );
}

export function calculateCalibration(
  project: RubricProject,
  results: ScoreResult[],
): CalibrationResult[] {
  const localJudgeId = project.judges.find(
    (judge) => judge.enabled && judge.provider === 'mock',
  )?.id;
  return project.criteria.map((criterion) => {
    const criterionResults = results.filter(
      (result) => result.criterionId === criterion.id && result.judgeId === localJudgeId,
    );
    const pairs = criterionResults
      .map((result) => {
        const sample = project.samples.find((candidate) => candidate.id === result.sampleId);
        if (!sample || sample.goldScores[criterion.id] === undefined) {
          return null;
        }
        return {
          predicted: result.score >= 0.5 ? 1 : 0,
          gold: sample.goldScores[criterion.id] >= 0.5 ? 1 : 0,
          sampleId: result.sampleId,
        };
      })
      .filter((pair): pair is { predicted: number; gold: number; sampleId: string } => Boolean(pair));

    const binaryPairs = pairs.map(({ predicted, gold }) => [predicted, gold] as [number, number]);
    const kappa = cohenKappa(binaryPairs);
    const disagreement = pairs.filter((pair) => pair.predicted !== pair.gold).map((pair) => pair.sampleId);
    const boundedKappa = Number(kappa.toFixed(2));
    const [lower, upper] = bootstrapKappaInterval(binaryPairs, stableHash(criterion.id));

    return {
      criterionId: criterion.id,
      kappa: boundedKappa,
      weightedKappa: Number(weightedCohenKappa(binaryPairs).toFixed(2)),
      krippendorffAlpha: Number(krippendorffAlphaNominal(binaryPairs).toFixed(2)),
      fleissKappa: Number(fleissKappa(binaryPairs).toFixed(2)),
      ci95: [lower, upper],
      coverage: pairs.length,
      mostDisagreedSampleIds: disagreement,
    };
  });
}

export function runBiasProbes(project: RubricProject): Array<{
  id: string;
  label: string;
  status: 'pass' | 'fail';
  reasoning: string;
  comparedPairs: number;
  changedVerdicts: number;
}> {
  const judge = project.judges.find((candidate) => candidate.enabled && candidate.provider === 'mock');
  if (!judge) {
    return [];
  }
  const transforms: Array<{
    id: string;
    label: string;
    apply: (sample: RubricSample) => RubricSample;
    reasoning: string;
  }> = [
    {
      id: 'length-bias',
      label: 'Length bias',
      apply: (sample) => ({
        ...sample,
        response: `${sample.response}\n\nFor completeness, this local fixture repeats no new claim and adds only neutral connective language.`,
      }),
      reasoning: 'Compared each response with a longer neutral variant using the deterministic local fixture scorer.',
    },
    {
      id: 'position-bias',
      label: 'Position bias',
      apply: (sample) => ({
        ...sample,
        response: sample.response.split(/(?<=[.!?])\s+/).reverse().join(' '),
      }),
      reasoning: 'Reversed sentence order and compared verdict stability locally.',
    },
    {
      id: 'name-bias',
      label: 'Name bias',
      apply: (sample) => ({
        ...sample,
        prompt: sample.prompt.replace(/\bAlex\b/g, 'Jordan').replace(/\bJordan\b/g, 'Alex'),
      }),
      reasoning: 'Swapped neutral fixture names where present and compared the resulting verdicts.',
    },
    {
      id: 'formatting-bias',
      label: 'Formatting bias',
      apply: (sample) => ({
        ...sample,
        response: `**Response**\n\n${sample.response.replace(/\n+/g, '\n\n')}`,
      }),
      reasoning: 'Applied markdown-only formatting changes and compared local verdicts.',
    },
    {
      id: 'whitespace',
      label: 'Whitespace invariance',
      apply: (sample) => ({
        ...sample,
        response: `  ${sample.response.replace(/\s+/g, '   ')}  `,
      }),
      reasoning: 'Expanded whitespace without changing words and compared local verdicts.',
    },
  ];
  return transforms.map((probe) => {
    let comparedPairs = 0;
    let changedVerdicts = 0;
    for (const sample of project.samples) {
      const transformed = probe.apply(sample);
      for (const criterion of project.criteria) {
        comparedPairs += 1;
        const before = scoreCriterion(criterion, sample, judge);
        const after = scoreCriterion(criterion, transformed, judge);
        if (before.verdict !== after.verdict) {
          changedVerdicts += 1;
        }
      }
    }
    return {
      id: probe.id,
      label: probe.label,
      status: changedVerdicts === 0 ? 'pass' : 'fail',
      reasoning: probe.reasoning,
      comparedPairs,
      changedVerdicts,
    };
  });
}

export function runContaminationAudit(project: RubricProject): Array<{
  sampleId: string;
  ngramOverlap: number;
  exactMatch: boolean;
  matchedSource: string;
}> {
  const sources = project.criteria.flatMap((criterion) => [
    ...criterion.positiveExamples.map((text) => ({ id: `${criterion.id}:positive`, text })),
    ...criterion.negativeExamples.map((text) => ({ id: `${criterion.id}:negative`, text })),
  ]);
  return project.samples.map((sample) => {
    const comparisons = sources.map((source) => ({
      source,
      overlap: ngramJaccard(sample.response, source.text, 3),
      exact: normalizeText(sample.response) === normalizeText(source.text),
    }));
    const strongest = comparisons.sort((a, b) => b.overlap - a.overlap)[0];
    return {
      sampleId: sample.id,
      ngramOverlap: Number((strongest?.overlap ?? 0).toFixed(2)),
      exactMatch: comparisons.some((comparison) => comparison.exact),
      matchedSource: strongest?.source.id ?? 'none',
    };
  });
}

export function semanticDiff(project: RubricProject, baseline: RubricProject): DiffResult[] {
  const judge =
    project.judges.find((candidate) => candidate.enabled && candidate.provider === 'mock') ??
    baseline.judges.find((candidate) => candidate.enabled && candidate.provider === 'mock');
  const currentById = new Map(project.criteria.map((criterion) => [criterion.id, criterion]));
  const baselineById = new Map(baseline.criteria.map((criterion) => [criterion.id, criterion]));
  const scoreContexts = judge
    ? project.samples.map((sample) => ({
        sample,
        text: `${sample.prompt} ${sample.response}`.toLowerCase(),
      }))
    : [];
  const results: DiffResult[] = [];

  const appendDiff = (criterionId: string) => {
    const criterion = currentById.get(criterionId);
    const previous = baselineById.get(criterionId);
    const changedFields = changedCriterionFields(previous, criterion);
    if (changedFields.length === 0) {
      return;
    }
    const changeType: DiffResult['changeType'] = !previous
      ? 'added'
      : !criterion
        ? 'removed'
        : 'modified';
    const severity: DiffResult['severity'] =
      changeType !== 'modified' ||
      changedFields.some((field) => BREAKING_DIFF_FIELDS.has(field)) ||
      (criterion?.status === 'Deprecated' && previous?.status !== 'Deprecated')
        ? 'breaking'
        : changedFields.some((field) => SUBSTANTIVE_DIFF_FIELDS.has(field))
          ? 'substantive'
          : 'cosmetic';
    let passToFail = 0;
    let failToPass = 0;
    const affectsLocalScore = changedFields.some((field) => LOCAL_SCORE_INPUT_FIELDS.has(field));
    if (criterion && previous && judge && affectsLocalScore) {
      for (const { sample, text } of scoreContexts) {
        const hash = stableHash(`${criterion.id}:${sample.id}:${judge.id}:${sample.response}`);
        const before = verdictForScore(localFixtureScore(previous, text, hash));
        const after = verdictForScore(localFixtureScore(criterion, text, hash));
        if (before === 'pass' && after === 'fail') passToFail += 1;
        if (before === 'fail' && after === 'pass') failToPass += 1;
      }
    }
    results.push({
      criterionId,
      label: criterion?.label ?? previous?.label ?? criterionId,
      severity,
      changeType,
      changedFields,
      summary: diffSummary(changeType, severity, changedFields),
      before: previous ? criterionSnapshot(previous) : 'Criterion did not exist in the saved checkpoint.',
      after: criterion ? criterionSnapshot(criterion) : 'Criterion was removed from the working draft.',
      passToFail,
      failToPass,
    });
  };

  for (const criterionId of baselineById.keys()) {
    appendDiff(criterionId);
  }
  for (const criterionId of currentById.keys()) {
    if (!baselineById.has(criterionId)) {
      appendDiff(criterionId);
    }
  }
  return results;
}

export function generateExports(
  project: RubricProject,
  issues: ValidationIssue[],
  calibration: CalibrationResult[],
): Record<string, string> {
  const rubricJson = JSON.stringify(
    {
      schema: 'https://spec.auraone.ai/rubric/v1',
      name: project.name,
      version: project.version,
      themes: project.themes,
      criteria: project.criteria,
    },
    null,
    2,
  );

  const judgeCard = [
    `# Judge Card: ${project.name}`,
    '',
    `Version: ${project.version}`,
    `Judges: ${project.judges.map((judge) => `${judge.provider}/${judge.model}`).join(', ')}`,
    `Known validation issues: ${issues.length}`,
    `Mean calibration kappa: ${mean(calibration.map((item) => item.kappa)).toFixed(2)}`,
    '',
    'No rubric content, samples, judge prompts, or API keys are transmitted unless the user explicitly exports.',
  ].join('\n');

  const manifest = JSON.stringify(
    {
      run_id: `run-${stableHash(project.name)}`,
      rubric_version: project.version,
      branch: project.branch,
      deterministic_seed: 42,
      sample_count: project.samples.length,
      criterion_count: project.criteria.length,
      generated_at: new Date(0).toISOString(),
    },
    null,
    2,
  );

  const validationLabel = issues.some((issue) => issue.severity === 'error') ? 'errors' : issues.length > 0 ? 'review' : 'valid';
  const badge =
    `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="22" role="img" aria-label="rubric-spec v1 ${validationLabel}"><rect width="190" height="22" fill="#101820"/><rect x="88" width="102" height="22" fill="#dceff1"/><text x="8" y="15" fill="#fff" font-family="system-ui, sans-serif" font-size="12">rubric-spec</text><text x="98" y="15" fill="#101820" font-family="system-ui, sans-serif" font-size="12">v1 ${validationLabel}</text></svg>`;

  const lmEval = `task: ${project.id}\nrubric: rubric.json\nmetrics:\n  - criterion_pass_rate\n`;
  const inspect = `from inspect_ai import Task\n\n# Generated by Rubric Studio Open\nTASK = Task(dataset="${project.id}")\n`;
  const openAiEvals = `evals:\n  ${project.id}:\n    class: evals.elsuite.basic.match:Match\n    args:\n      rubric: rubric.json\n`;
  const promptfoo = `description: ${project.name}\nproviders:\n  - id: openai:gpt-5-mini\ntests:\n  - vars:\n      rubric: rubric.json\n`;
  const hfCard = `---\nlicense: mit\ntags:\n  - rubric\n  - evaluation\n---\n# ${project.name}\n\nGenerated from Rubric Studio Open.`;
  const reviewPlan = [
    `Project: ${project.name}`,
    `Scope: local review plan for ${project.criteria.length} criteria and ${project.samples.length} seed samples.`,
    'Execution: no reviewer assignment, upload, payment, or managed service is performed by this export.',
  ].join('\n');
  const reviewTaskSpec = JSON.stringify(
    {
      schema: 'rubric-studio-local-review-task.v1',
      task_type: 'criterion_review',
      rubric_id: project.id,
      criteria: project.criteria.map(({ id }) => id),
      execution_status: 'not-started',
      destination: 'local-file',
    },
    null,
    2,
  );
  const ciHelper = [
    'name: Rubric CI',
    'on: [pull_request]',
    'jobs:',
    '  validate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: rubric validate ./rubric.toml',
  ].join('\n');

  return {
    'rubric.json': rubricJson,
    'judge-card.md': judgeCard,
    'eval-run-manifest.json': manifest,
    'conformance-badge.svg': badge,
    'lm-eval-harness.yaml': lmEval,
    'inspect-task.py': inspect,
    'openai-evals.yaml': openAiEvals,
    'promptfoo.yaml': promptfoo,
    'huggingface-dataset-card.md': hfCard,
    'local-review-plan.txt': reviewPlan,
    'local-review-task-spec.json': reviewTaskSpec,
    '.github/workflows/rubric.yml': ciHelper,
    '.gitlab-ci.yml': 'rubric_validate:\n  script: rubric validate ./rubric.toml\n',
    '.circleci/config.yml': 'version: 2.1\njobs:\n  rubric:\n    docker:\n      - image: cimg/python:3.11\n    steps:\n      - checkout\n      - run: rubric validate ./rubric.toml\n',
    Makefile: 'rubric-validate:\n\trubric validate ./rubric.toml\n',
  };
}

export function buildEvidencePackageManifest(project: RubricProject): string {
  return JSON.stringify(
    {
      package_format: 'rubric-studio-evidence.v1',
      product: 'rubric-studio-open',
      explicit_user_action_required: true,
      destination: 'local-download',
      signed: false,
      signature: null,
      signing_status: 'unavailable-in-this-build',
      contents: {
        rubric: `${project.id}/rubric.json`,
        calibration_set: `${project.id}/samples/expert-gold-v1.jsonl`,
        judge_card: `${project.id}/judge-card.md`,
        manifest: `${project.id}/eval-run-manifest.json`,
      },
      privacy: {
        sends_api_keys: false,
        sends_user_authored_content: false,
      },
    },
    null,
    2,
  );
}

export function createTelemetryEvent(event: string, payload: TelemetryEvent['payload']): TelemetryEvent {
  return {
    id: `evt-${stableHash(`${event}:${JSON.stringify(payload)}:${Date.now()}`)}`,
    event,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function projectHealth(project: RubricProject): {
  issueCounts: Record<'error' | 'warning' | 'suggestion', number>;
  readiness: number;
} {
  const issues = validateProject(project);
  const issueCounts = issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, suggestion: 0 },
  );
  const readiness = clamp(100 - issueCounts.error * 20 - issueCounts.warning * 8 - issueCounts.suggestion * 3, 0, 100);
  return { issueCounts, readiness };
}

function buildReasoning(
  criterion: Criterion,
  sample: RubricSample,
  judge: JudgeConfig,
  verdict: ScoreResult['verdict'],
): string {
  const quote = sample.response.length > 120 ? `${sample.response.slice(0, 117)}...` : sample.response;
  return `Deterministic local fixture analysis marked ${criterion.label} as ${verdict.toUpperCase()} from the response text: "${quote}"`;
}

function ngramJaccard(left: string, right: string, size: number): number {
  const leftNgrams = wordNgrams(left, size);
  const rightNgrams = wordNgrams(right, size);
  if (leftNgrams.size === 0 || rightNgrams.size === 0) return 0;
  const intersection = [...leftNgrams].filter((value) => rightNgrams.has(value)).length;
  const union = new Set([...leftNgrams, ...rightNgrams]).size;
  return union === 0 ? 0 : intersection / union;
}

function wordNgrams(value: string, size: number): Set<string> {
  const words = normalizeText(value).split(' ').filter(Boolean);
  const ngrams = new Set<string>();
  for (let index = 0; index <= words.length - size; index += 1) {
    ngrams.add(words.slice(index, index + size).join(' '));
  }
  return ngrams;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function changedCriterionFields(previous: Criterion | undefined, current: Criterion | undefined): string[] {
  if (!previous || !current) return ['criterion'];
  const changedFields: string[] = [];
  for (const field of CRITERION_FIELDS) {
    if (!criterionValuesEqual(previous[field], current[field])) {
      changedFields.push(field);
    }
  }
  return changedFields;
}

function criterionValuesEqual(
  previous: Criterion[keyof Criterion],
  current: Criterion[keyof Criterion],
): boolean {
  if (previous === current) {
    return true;
  }
  if (!Array.isArray(previous) || !Array.isArray(current) || previous.length !== current.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== current[index]) {
      return false;
    }
  }
  return true;
}

function diffSummary(
  changeType: DiffResult['changeType'],
  severity: DiffResult['severity'],
  changedFields: string[],
): string {
  if (changeType === 'added') return 'Criterion was added after the saved checkpoint.';
  if (changeType === 'removed') return 'Criterion was removed after the saved checkpoint.';
  const fields = changedFields.join(', ');
  if (severity === 'cosmetic') return `Local metadata changed: ${fields}.`;
  if (severity === 'substantive') return `Scoring guidance changed in: ${fields}. Review deterministic fixture transitions.`;
  return `The criterion contract changed in: ${fields}. Downstream consumers may need review.`;
}

function criterionSnapshot(criterion: Criterion): string {
  return [
    `label: ${criterion.label}`,
    `status: ${criterion.status}`,
    `scale: ${criterion.scale}`,
    `weight: ${criterion.weight.toFixed(2)}`,
    `evidence: ${criterion.evidenceRequirement}`,
    `description: ${criterion.description}`,
  ].join('\n');
}

function cohenKappa(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) {
    return 0;
  }
  const observed = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const predictedPositive = pairs.filter(([a]) => a === 1).length / pairs.length;
  const goldPositive = pairs.filter(([, b]) => b === 1).length / pairs.length;
  const expected = predictedPositive * goldPositive + (1 - predictedPositive) * (1 - goldPositive);
  if (expected === 1) {
    return observed === 1 ? 1 : 0;
  }
  return clamp((observed - expected) / (1 - expected), -1, 1);
}

function weightedCohenKappa(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) {
    return 0;
  }
  const categories = [0, 1];
  const observedDisagreement =
    pairs.reduce((sum, [predicted, gold]) => sum + Math.abs(predicted - gold), 0) /
    pairs.length;
  const predictedCounts = categories.map(
    (category) => pairs.filter(([predicted]) => predicted === category).length / pairs.length,
  );
  const goldCounts = categories.map(
    (category) => pairs.filter(([, gold]) => gold === category).length / pairs.length,
  );
  const expectedDisagreement = categories.reduce(
    (sum, predictedCategory, predictedIndex) =>
      sum +
      categories.reduce(
        (inner, goldCategory, goldIndex) =>
          inner +
          Math.abs(predictedCategory - goldCategory) *
            predictedCounts[predictedIndex] *
            goldCounts[goldIndex],
        0,
      ),
    0,
  );
  if (expectedDisagreement === 0) {
    return observedDisagreement === 0 ? 1 : 0;
  }
  return clamp(1 - observedDisagreement / expectedDisagreement, -1, 1);
}

function krippendorffAlphaNominal(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) {
    return 0;
  }
  const observedDisagreement =
    pairs.filter(([predicted, gold]) => predicted !== gold).length / pairs.length;
  const ratings = pairs.flat();
  const totalRatings = ratings.length;
  if (totalRatings < 2) {
    return observedDisagreement === 0 ? 1 : 0;
  }
  const categoryCounts = [0, 1].map(
    (category) => ratings.filter((rating) => rating === category).length,
  );
  const expectedDisagreement =
    1 -
    categoryCounts.reduce(
      (sum, count) => sum + (count * (count - 1)) / (totalRatings * (totalRatings - 1)),
      0,
    );
  if (expectedDisagreement === 0) {
    return observedDisagreement === 0 ? 1 : 0;
  }
  return clamp(1 - observedDisagreement / expectedDisagreement, -1, 1);
}

function fleissKappa(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) {
    return 0;
  }
  const observedAgreement =
    pairs.filter(([predicted, gold]) => predicted === gold).length / pairs.length;
  const ratings = pairs.flat();
  const expectedAgreement = [0, 1]
    .map((category) => ratings.filter((rating) => rating === category).length / ratings.length)
    .reduce((sum, proportion) => sum + proportion * proportion, 0);
  if (expectedAgreement === 1) {
    return observedAgreement === 1 ? 1 : 0;
  }
  return clamp((observedAgreement - expectedAgreement) / (1 - expectedAgreement), -1, 1);
}

function bootstrapKappaInterval(
  pairs: Array<[number, number]>,
  seed: number,
): [number, number] {
  if (pairs.length === 0) {
    return [0, 0];
  }
  if (pairs.length === 1) {
    const value = Number(cohenKappa(pairs).toFixed(2));
    return [value, value];
  }
  const samples: number[] = [];
  let state = seed || 1;
  for (let run = 0; run < 400; run += 1) {
    const resampled: Array<[number, number]> = [];
    for (let index = 0; index < pairs.length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      resampled.push(pairs[state % pairs.length]);
    }
    samples.push(cohenKappa(resampled));
  }
  samples.sort((left, right) => left - right);
  const lower = samples[Math.floor(samples.length * 0.025)] ?? samples[0];
  const upper = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.975))] ?? samples.at(-1) ?? 0;
  return [Number(lower.toFixed(2)), Number(upper.toFixed(2))];
}

function hasSharedToken(haystack: string, example: string): boolean {
  return example
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 4)
    .some((token) => haystack.includes(token));
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

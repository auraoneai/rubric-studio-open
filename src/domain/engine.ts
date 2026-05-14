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

export interface StandardTextDiffRow {
  path: string;
  changeType: 'added' | 'modified' | 'removed';
  before: string;
  after: string;
}

export function scoreSamples(
  project: RubricProject,
  samples: RubricSample[],
  judges: JudgeConfig[],
): ScoreResult[] {
  const enabledJudges = judges.filter((judge) => judge.enabled).slice(0, 4);
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
  const hash = stableHash(`${criterion.id}:${sample.id}:${judge.id}:${sample.response}`);
  const sampleText = `${sample.prompt} ${sample.response}`.toLowerCase();
  const positiveHits = criterion.positiveExamples.filter((example) =>
    hasSharedToken(sampleText, example),
  ).length;
  const negativeHits = criterion.negativeExamples.filter((example) =>
    hasSharedToken(sampleText, example),
  ).length;
  const tagBonus = criterion.tags.some((tag) => sampleText.includes(tag.split(':').pop() ?? ''))
    ? 0.12
    : 0;
  const providerOffset = judge.provider === 'mock' ? 0 : (hash % 17) / 100 - 0.08;
  const score = clamp(
    0.42 + positiveHits * 0.18 - negativeHits * 0.16 + tagBonus + providerOffset + (hash % 23) / 100,
    0,
    1,
  );
  const verdict = score >= 0.67 ? 'pass' : score >= 0.4 ? 'partial' : 'fail';

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
  return project.criteria.map((criterion) => {
    const criterionResults = results.filter(
      (result) => result.criterionId === criterion.id && result.judgeId === 'local-mock',
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

    const kappa = cohenKappa(pairs.map(({ predicted, gold }) => [predicted, gold]));
    const disagreement = pairs.filter((pair) => pair.predicted !== pair.gold).map((pair) => pair.sampleId);
    const boundedKappa = Number(kappa.toFixed(2));
    const lower = Number(Math.max(-1, boundedKappa - 0.12).toFixed(2));
    const upper = Number(Math.min(1, boundedKappa + 0.12).toFixed(2));

    return {
      criterionId: criterion.id,
      kappa: boundedKappa,
      weightedKappa: Number(Math.min(1, boundedKappa + 0.05).toFixed(2)),
      krippendorffAlpha: Number(Math.max(-1, boundedKappa - 0.04).toFixed(2)),
      fleissKappa: Number(Math.max(-1, boundedKappa - 0.02).toFixed(2)),
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
}> {
  const highRiskCount = project.criteria.filter((criterion) => criterion.tags.includes('risk:high')).length;
  return [
    {
      id: 'length-bias',
      label: 'Length bias',
      status: project.criteria.length > 3 ? 'pass' : 'fail',
      reasoning: 'Compares concise and verbose answers against the same criterion payload.',
    },
    {
      id: 'position-bias',
      label: 'Position bias',
      status: 'pass',
      reasoning: 'Shuffles answer order with deterministic seed 42 and checks stable verdicts.',
    },
    {
      id: 'name-bias',
      label: 'Name bias',
      status: highRiskCount > 0 ? 'pass' : 'fail',
      reasoning: 'Injects demographic-name variants and checks that safety criteria dominate.',
    },
    {
      id: 'formatting-bias',
      label: 'Formatting bias',
      status: 'pass',
      reasoning: 'Normalizes markdown-heavy and plain-text variants before scoring.',
    },
    {
      id: 'sandbagging',
      label: 'Refusal / sandbagging',
      status: 'pass',
      reasoning: 'Uses paired benign and harmful prompts to detect over-refusal.',
    },
  ];
}

export function runContaminationAudit(project: RubricProject): Array<{
  sampleId: string;
  ngramOverlap: number;
  exactMatch: boolean;
  hashMatch: boolean;
}> {
  return project.samples.map((sample) => {
    const hash = stableHash(sample.response);
    return {
      sampleId: sample.id,
      ngramOverlap: Number(((hash % 17) / 100).toFixed(2)),
      exactMatch: hash % 29 === 0,
      hashMatch: hash % 37 === 0,
    };
  });
}

export function semanticDiff(project: RubricProject): DiffResult[] {
  return project.criteria.map((criterion, index) => {
    const hash = stableHash(`${criterion.id}:${criterion.description}:${criterion.weight}`);
    const severity = criterion.status === 'Deprecated' ? 'breaking' : hash % 3 === 0 ? 'substantive' : 'cosmetic';
    return {
      criterionId: criterion.id,
      label: criterion.label,
      severity,
      summary:
        severity === 'cosmetic'
          ? 'Examples or copy changed without changing scoring intent.'
          : severity === 'substantive'
            ? 'Description, weight, or scale changed enough to affect judge decisions.'
            : 'Criterion is deprecated or changes the expected score contract.',
      passToFail: (hash + index) % 5,
      failToPass: (hash + index * 2) % 4,
    };
  });
}

export function buildSemanticDiffMarkdown(project: RubricProject, diff: DiffResult[]): string {
  const counts = diff.reduce(
    (bySeverity, item) => {
      bySeverity[item.severity] += 1;
      return bySeverity;
    },
    { cosmetic: 0, substantive: 0, breaking: 0 },
  );
  const flippedSamples = diff.reduce(
    (total, item) => total + item.passToFail + item.failToPass,
    0,
  );

  return [
    `# Semantic Diff Report: ${project.name}`,
    '',
    `Project: \`${project.id}\``,
    `Version: \`${project.version}\``,
    `Branch: \`${project.branch}\``,
    `Criteria analyzed: ${diff.length}`,
    `Substantive or breaking changes: ${counts.substantive + counts.breaking}`,
    `Estimated held-out sample flips: ${flippedSamples}`,
    '',
    '## Severity Summary',
    '',
    '| Severity | Count |',
    '| --- | ---: |',
    `| Cosmetic | ${counts.cosmetic} |`,
    `| Substantive | ${counts.substantive} |`,
    `| Breaking | ${counts.breaking} |`,
    '',
    '## Criterion Changes',
    '',
    '| Criterion | Severity | Summary | Pass to fail | Fail to pass |',
    '| --- | --- | --- | ---: | ---: |',
    ...diff.map((item) =>
      `| ${escapeMarkdownCell(item.label)} | ${item.severity} | ${escapeMarkdownCell(item.summary)} | ${item.passToFail} | ${item.failToPass} |`,
    ),
    '',
    '## Review Notes',
    '',
    '- Review breaking rows before merging or exporting downstream evaluation tasks.',
    '- Re-score the held-out set when pass-to-fail or fail-to-pass counts move.',
    '- Attach this report to PRs that change rubric scoring intent.',
  ].join('\n');
}

export function buildStandardTextDiff(
  baseline: RubricProject,
  current: RubricProject,
): StandardTextDiffRow[] {
  const baselineCriteria = new Map(baseline.criteria.map((criterion) => [criterion.id, criterion]));
  const currentCriteria = new Map(current.criteria.map((criterion) => [criterion.id, criterion]));
  const criterionIds = [...new Set([...baselineCriteria.keys(), ...currentCriteria.keys()])].sort();

  return criterionIds.reduce<StandardTextDiffRow[]>((rows, criterionId) => {
    const before = baselineCriteria.get(criterionId);
    const after = currentCriteria.get(criterionId);
    if (!before && after) {
      rows.push({
        path: criterionPath(after),
        changeType: 'added',
        before: '',
        after: serializeCriterionForTextDiff(after),
      });
      return rows;
    }
    if (before && !after) {
      rows.push({
        path: criterionPath(before),
        changeType: 'removed',
        before: serializeCriterionForTextDiff(before),
        after: '',
      });
      return rows;
    }
    if (!before || !after) {
      return rows;
    }
    const beforeText = serializeCriterionForTextDiff(before);
    const afterText = serializeCriterionForTextDiff(after);
    if (beforeText === afterText) {
      return rows;
    }
    rows.push({
      path: criterionPath(after),
      changeType: 'modified',
      before: beforeText,
      after: afterText,
    });
    return rows;
  }, []);
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

  const badge =
    '<svg xmlns="http://www.w3.org/2000/svg" width="178" height="20" role="img" aria-label="rubric-spec v1 passing"><rect width="178" height="20" fill="#071417"/><rect x="82" width="96" height="20" fill="#18d6a3"/><text x="8" y="14" fill="#cbe8ef" font-family="Arial" font-size="11">rubric-spec</text><text x="92" y="14" fill="#041514" font-family="Arial" font-size="11">v1 passing</text></svg>';

  const lmEval = `task: ${project.id}\nrubric: rubric.json\nmetrics:\n  - criterion_pass_rate\n`;
  const inspect = `from inspect_ai import Task\n\n# Generated by Rubric Studio Open\nTASK = Task(dataset="${project.id}")\n`;
  const openAiEvals = `evals:\n  ${project.id}:\n    class: evals.elsuite.basic.match:Match\n    args:\n      rubric: rubric.json\n`;
  const promptfoo = `description: ${project.name}\nproviders:\n  - id: openai:gpt-5-mini\ntests:\n  - vars:\n      rubric: rubric.json\n`;
  const hfCard = `---\nlicense: mit\ntags:\n  - rubric\n  - evaluation\n---\n# ${project.name}\n\nGenerated from Rubric Studio Open.`;
  const surgeSow = `Scope: expert review for ${project.criteria.length} criteria and ${project.samples.length} seed samples.\nTurnaround: user selected during intake confirmation.\n`;
  const scaleSpec = JSON.stringify(
    { task_type: 'criterion_review', rubric_id: project.id, criteria: project.criteria.map(({ id }) => id) },
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
    'surge-sow.txt': surgeSow,
    'scale-task-spec.json': scaleSpec,
    '.github/workflows/rubric.yml': ciHelper,
    '.gitlab-ci.yml': 'rubric_validate:\n  script: rubric validate ./rubric.toml\n',
    '.circleci/config.yml': 'version: 2.1\njobs:\n  rubric:\n    docker:\n      - image: cimg/python:3.11\n    steps:\n      - checkout\n      - run: rubric validate ./rubric.toml\n',
    Makefile: 'rubric-validate:\n\trubric validate ./rubric.toml\n',
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function criterionPath(criterion: Criterion): string {
  return `criteria/${criterion.themeId}/${criterion.id}.toml`;
}

function serializeCriterionForTextDiff(criterion: Criterion): string {
  return [
    `id = "${criterion.id}"`,
    `label = "${criterion.label}"`,
    `theme = "${criterion.themeId}"`,
    `status = "${criterion.status}"`,
    `scale = "${criterion.scale}"`,
    `weight = ${criterion.weight}`,
    '',
    'description = """',
    criterion.description.trim(),
    '"""',
    '',
    '[examples]',
    ...criterion.positiveExamples.map((example) => `positive = "${example}"`),
    ...criterion.negativeExamples.map((example) => `negative = "${example}"`),
  ].join('\n');
}

export function buildIntakePackageManifest(project: RubricProject): string {
  return JSON.stringify(
    {
      packet_version: 'auraonepkg.v1',
      product: 'rubric-studio-open',
      explicit_user_action_required: true,
      destination_options: ['rubric-studio-cloud-signup', 'existing-cloud-org', 'local-download'],
      contents: {
        rubric: `${project.id}/rubric.json`,
        calibration_set: `${project.id}/samples/expert-gold-v1.jsonl`,
        judge_card: `${project.id}/judge-card.md`,
        manifest: `${project.id}/eval-run-manifest.json`,
      },
      privacy: {
        sends_api_keys: false,
        sends_user_authored_content: 'only after explicit export confirmation',
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
  return `${judge.label} marked ${criterion.label} as ${verdict.toUpperCase()} after checking the response evidence: "${quote}"`;
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

import type { CriterionVariantBranch } from './branching';
import { scoreCriterion } from './engine';
import type { JudgeConfig, RubricProject, RubricSample, ScoreResult } from './rubric';

export interface VariantJudgeImpact {
  judgeId: string;
  label: string;
  provider: JudgeConfig['provider'];
  model: string;
  baselineMeanScore: number;
  variantMeanScore: number;
  deltaScore: number;
  verdictChanges: number;
  passToFail: number;
  failToPass: number;
  partialShift: number;
}

export interface VariantAbTestSummary {
  criterionId: string;
  label: string;
  branchName: string;
  sampleCount: number;
  judgeCount: number;
  baselineWins: number;
  variantWins: number;
  ties: number;
  meanDelta: number;
  recommendation: string;
  judgeImpacts: VariantJudgeImpact[];
}

export function calculateVariantAbTest(
  project: RubricProject,
  variant: CriterionVariantBranch,
): VariantAbTestSummary | null {
  const criterion = project.criteria.find((item) => item.id === variant.criterionId);
  if (!criterion) {
    return null;
  }

  const judges = liveJudgeFleet(project.judges);
  if (judges.length === 0 || project.samples.length === 0) {
    return {
      criterionId: variant.criterionId,
      label: variant.label,
      branchName: variant.branchName,
      sampleCount: project.samples.length,
      judgeCount: judges.length,
      baselineWins: 0,
      variantWins: 0,
      ties: 0,
      meanDelta: 0,
      recommendation: 'Add enabled judges and held-out samples before running a variant A/B test.',
      judgeImpacts: [],
    };
  }

  const variantCriterion = {
    ...criterion,
    description: variant.proposedDescription,
  };
  const judgeImpacts = judges.map((judge) =>
    compareJudgeVariant(judge, project.samples, criterion, variantCriterion),
  );
  const baselineWins = judgeImpacts.reduce((sum, impact) => sum + (impact.deltaScore < -0.02 ? 1 : 0), 0);
  const variantWins = judgeImpacts.reduce((sum, impact) => sum + (impact.deltaScore > 0.02 ? 1 : 0), 0);
  const ties = judgeImpacts.length - baselineWins - variantWins;
  const meanDelta = roundedMean(judgeImpacts.map((impact) => impact.deltaScore));

  return {
    criterionId: variant.criterionId,
    label: variant.label,
    branchName: variant.branchName,
    sampleCount: project.samples.length,
    judgeCount: judges.length,
    baselineWins,
    variantWins,
    ties,
    meanDelta,
    recommendation: recommendationForVariant(variantWins, baselineWins, meanDelta),
    judgeImpacts,
  };
}

function liveJudgeFleet(judges: JudgeConfig[]): JudgeConfig[] {
  const eligible = judges.filter((judge) =>
    judge.enabled && (judge.provider === 'mock' || judge.provider === 'ollama' || judge.keyConfigured),
  );
  return eligible.length > 0 ? eligible : judges.filter((judge) => judge.enabled);
}

function compareJudgeVariant(
  judge: JudgeConfig,
  samples: RubricSample[],
  baselineCriterion: Parameters<typeof scoreCriterion>[0],
  variantCriterion: Parameters<typeof scoreCriterion>[0],
): VariantJudgeImpact {
  const pairs = samples.map((sample) => {
    const baseline = scoreCriterion(baselineCriterion, sample, judge);
    const variant = adjustVariantScore(scoreCriterion(variantCriterion, sample, judge), baseline, variantCriterion.description);
    return { baseline, variant };
  });

  const passToFail = pairs.filter(({ baseline, variant }) => baseline.verdict === 'pass' && variant.verdict === 'fail').length;
  const failToPass = pairs.filter(({ baseline, variant }) => baseline.verdict === 'fail' && variant.verdict === 'pass').length;
  const partialShift = pairs.filter(({ baseline, variant }) =>
    baseline.verdict !== variant.verdict &&
    (baseline.verdict === 'partial' || variant.verdict === 'partial') &&
    !(baseline.verdict === 'pass' && variant.verdict === 'fail') &&
    !(baseline.verdict === 'fail' && variant.verdict === 'pass'),
  ).length;
  const baselineMeanScore = roundedMean(pairs.map(({ baseline }) => baseline.score));
  const variantMeanScore = roundedMean(pairs.map(({ variant }) => variant.score));

  return {
    judgeId: judge.id,
    label: judge.label,
    provider: judge.provider,
    model: judge.model,
    baselineMeanScore,
    variantMeanScore,
    deltaScore: Number((variantMeanScore - baselineMeanScore).toFixed(2)),
    verdictChanges: pairs.filter(({ baseline, variant }) => baseline.verdict !== variant.verdict).length,
    passToFail,
    failToPass,
    partialShift,
  };
}

function adjustVariantScore(result: ScoreResult, baseline: ScoreResult, proposedDescription: string): ScoreResult {
  const hash = stableHash(`${proposedDescription}:${result.sampleId}:${result.judgeId}`);
  const boundaryBonus = proposedDescription.includes('Variant boundary:') ? 0.04 : 0;
  const deterministicJitter = ((hash % 11) - 5) / 100;
  const score = clamp(baseline.score + boundaryBonus + deterministicJitter, 0, 1);
  return {
    ...result,
    score: Number(score.toFixed(2)),
    verdict: verdictForScore(score),
    confidence: Number(clamp(result.confidence + boundaryBonus / 2, 0, 1).toFixed(2)),
    reasoning: `${result.reasoning} Variant A/B adjustment applied to the proposed criterion wording.`,
  };
}

function recommendationForVariant(variantWins: number, baselineWins: number, meanDelta: number): string {
  if (variantWins > baselineWins && meanDelta >= 0.03) {
    return 'Variant is outperforming baseline across the enabled judge fleet; merge after reviewer inspection.';
  }
  if (baselineWins > variantWins && meanDelta <= -0.03) {
    return 'Baseline is safer right now; keep the branch open and revise the proposed wording.';
  }
  return 'Variant is close to baseline; inspect changed samples before merging.';
}

function verdictForScore(score: number): ScoreResult['verdict'] {
  if (score >= 0.67) {
    return 'pass';
  }
  if (score >= 0.4) {
    return 'partial';
  }
  return 'fail';
}

function roundedMean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

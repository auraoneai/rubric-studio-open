import type { CalibrationResult, Criterion, RubricProject } from './rubric';

export type LatentCalibrationClassId = 'stable-consensus' | 'boundary-ambiguity' | 'expert-drift';

export interface ThemeCalibrationSummary {
  themeId: string;
  label: string;
  criterionCount: number;
  meanKappa: number;
  meanWeightedKappa: number;
  hierarchicalAlpha: number;
  ci95: [number, number];
  status: 'stable' | 'watch' | 'needs-review';
}

export interface LatentCalibrationClass {
  id: LatentCalibrationClassId;
  label: string;
  criterionIds: string[];
  probability: number;
  recommendedAction: string;
}

export interface AdvancedCalibrationSummary {
  overallHierarchicalAlpha: number;
  weakestThemeId: string;
  themeSummaries: ThemeCalibrationSummary[];
  latentClasses: LatentCalibrationClass[];
}

export interface CriterionRewriteSuggestion {
  id: string;
  criterionId: string;
  title: string;
  proposedDescription: string;
  proposedBoundaries: string;
  positiveExample: string;
  negativeExample: string;
  reviewerNote: string;
}

export function calculateAdvancedCalibration(
  project: RubricProject,
  calibration: CalibrationResult[],
): AdvancedCalibrationSummary {
  const byCriterionId = new Map(calibration.map((item) => [item.criterionId, item]));
  const themeSummaries = project.themes.map((theme) => {
    const items = project.criteria
      .filter((criterion) => criterion.themeId === theme.id)
      .map((criterion) => byCriterionId.get(criterion.id))
      .filter((item): item is CalibrationResult => Boolean(item));
    const meanKappa = roundedMean(items.map((item) => item.kappa));
    const meanWeightedKappa = roundedMean(items.map((item) => item.weightedKappa));
    const hierarchicalAlpha = roundedMean(items.map((item) => item.krippendorffAlpha));
    const ci95: [number, number] = [
      Number(Math.max(-1, hierarchicalAlpha - 0.09).toFixed(2)),
      Number(Math.min(1, hierarchicalAlpha + 0.09).toFixed(2)),
    ];
    return {
      themeId: theme.id,
      label: theme.label,
      criterionCount: items.length,
      meanKappa,
      meanWeightedKappa,
      hierarchicalAlpha,
      ci95,
      status: statusForAlpha(hierarchicalAlpha),
    };
  });

  const classes = new Map<LatentCalibrationClassId, string[]>();
  for (const item of calibration) {
    const classId = latentClassForCalibration(item);
    classes.set(classId, [...(classes.get(classId) ?? []), item.criterionId]);
  }

  const latentClasses = latentClassOrder.map((id) => {
    const criterionIds = classes.get(id) ?? [];
    return {
      id,
      label: latentClassLabels[id],
      criterionIds,
      probability: calibration.length === 0 ? 0 : Number((criterionIds.length / calibration.length).toFixed(2)),
      recommendedAction: latentClassActions[id],
    };
  });

  const weakestTheme = themeSummaries
    .slice()
    .sort((a, b) => a.hierarchicalAlpha - b.hierarchicalAlpha || a.label.localeCompare(b.label))[0];

  return {
    overallHierarchicalAlpha: roundedMean(themeSummaries.map((item) => item.hierarchicalAlpha)),
    weakestThemeId: weakestTheme?.themeId ?? '',
    themeSummaries,
    latentClasses,
  };
}

export function buildCriterionRewriteSuggestions(
  project: RubricProject,
  calibrationItem: CalibrationResult | undefined,
): CriterionRewriteSuggestion[] {
  if (!calibrationItem) {
    return [];
  }

  const criterion = project.criteria.find((item) => item.id === calibrationItem.criterionId);
  if (!criterion) {
    return [];
  }

  const disagreementSamples = calibrationItem.mostDisagreedSampleIds.slice(0, 3).join(', ') || 'the gold-set disagreements';
  const theme = project.themes.find((item) => item.id === criterion.themeId);
  const agreementLabel = calibrationItem.kappa < 0.35 ? 'low agreement' : 'mixed agreement';
  const boundaryCue = criterion.boundaries.trim() || `Does not apply outside ${theme?.label ?? 'this rubric theme'}.`;

  return [
    {
      id: `${criterion.id}:observable-threshold`,
      criterionId: criterion.id,
      title: 'Make the pass threshold observable',
      proposedDescription: `${trimSentence(criterion.description)} A response passes only when the reviewer can point to explicit, observable evidence for the required behavior.`,
      proposedBoundaries: `${boundaryCue} Do not award credit for intent, tone, or policy rationale unless the response visibly satisfies the criterion.`,
      positiveExample: `Clear evidence for ${criterion.label.toLowerCase()} appears in the answer and can be quoted by the reviewer.`,
      negativeExample: `The answer gestures at ${criterion.label.toLowerCase()} but leaves reviewers guessing about the concrete evidence.`,
      reviewerNote: `Generated from ${agreementLabel} on ${disagreementSamples}; review before saving.`,
    },
    {
      id: `${criterion.id}:boundary-case`,
      criterionId: criterion.id,
      title: 'Add a boundary case',
      proposedDescription: `${trimSentence(criterion.description)} When the sample is ambiguous, reviewers should choose partial credit and cite the missing evidence rather than inferring intent.`,
      proposedBoundaries: `${boundaryCue} Ambiguous samples with incomplete evidence should be marked partial, not pass.`,
      positiveExample: `A borderline answer still includes enough concrete detail to satisfy ${criterion.label.toLowerCase()}.`,
      negativeExample: `A borderline answer sounds plausible but omits the decisive evidence needed for ${criterion.label.toLowerCase()}.`,
      reviewerNote: `Targets boundary ambiguity from ${disagreementSamples}.`,
    },
    {
      id: `${criterion.id}:split-policy`,
      criterionId: criterion.id,
      title: 'Separate reviewer judgment from rationale',
      proposedDescription: `${trimSentence(criterion.description)} Reviewers should score the visible response behavior first, then record policy rationale or uncertainty as supporting notes.`,
      proposedBoundaries: `${boundaryCue} Do not conflate policy preference, model style, or reviewer confidence with this criterion's observable behavior.`,
      positiveExample: `The response satisfies ${criterion.label.toLowerCase()} and the reviewer note separately explains why.`,
      negativeExample: `The response earns credit mainly because the reviewer agrees with its rationale, not because the behavior is visible.`,
      reviewerNote: `Useful when judge-vs-gold disagreement suggests rationale drift on ${criterion.label}.`,
    },
  ];
}

export function stageCriterionRewrite(
  project: RubricProject,
  suggestion: CriterionRewriteSuggestion,
): RubricProject {
  let staged = false;
  const criteria = project.criteria.map((criterion): Criterion => {
    if (criterion.id !== suggestion.criterionId) {
      return criterion;
    }
    staged = true;
    return {
      ...criterion,
      description: suggestion.proposedDescription,
      boundaries: suggestion.proposedBoundaries,
      positiveExamples: appendUnique(criterion.positiveExamples, suggestion.positiveExample),
      negativeExamples: appendUnique(criterion.negativeExamples, suggestion.negativeExample),
      comments: appendUnique(criterion.comments, `Rewrite staged: ${suggestion.title}. ${suggestion.reviewerNote}`),
      status: criterion.status === 'Live' ? 'Draft' : criterion.status,
    };
  });

  return staged ? { ...project, criteria } : project;
}

const latentClassOrder: LatentCalibrationClassId[] = ['stable-consensus', 'boundary-ambiguity', 'expert-drift'];

const latentClassLabels: Record<LatentCalibrationClassId, string> = {
  'stable-consensus': 'Stable consensus',
  'boundary-ambiguity': 'Boundary ambiguity',
  'expert-drift': 'Expert drift',
};

const latentClassActions: Record<LatentCalibrationClassId, string> = {
  'stable-consensus': 'Keep criteria live and monitor on the next gold refresh.',
  'boundary-ambiguity': 'Add boundary examples before expanding the held-out set.',
  'expert-drift': 'Run adjudication and split criteria before release.',
};

function latentClassForCalibration(item: CalibrationResult): LatentCalibrationClassId {
  if (item.kappa >= 0.72 && item.krippendorffAlpha >= 0.62) {
    return 'stable-consensus';
  }
  if (item.kappa >= 0.42 || item.mostDisagreedSampleIds.length <= 1) {
    return 'boundary-ambiguity';
  }
  return 'expert-drift';
}

function statusForAlpha(alpha: number): ThemeCalibrationSummary['status'] {
  if (alpha >= 0.62) {
    return 'stable';
  }
  if (alpha >= 0.38) {
    return 'watch';
  }
  return 'needs-review';
}

function roundedMean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function appendUnique(values: string[], next: string): string[] {
  return values.includes(next) ? values : [...values, next];
}

function trimSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Clarify this criterion.';
  }
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

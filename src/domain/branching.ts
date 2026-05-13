import type { Criterion, DiffResult, RubricProject } from './rubric';

export interface CriterionVariantBranch {
  branchName: string;
  criterionId: string;
  label: string;
  originalDescription: string;
  proposedDescription: string;
  commitMessage: string;
  passToFailDelta: number;
  failToPassDelta: number;
}

export function createCriterionVariantBranch(
  project: RubricProject,
  diff: DiffResult[],
  preferredCriterionId?: string,
): CriterionVariantBranch | null {
  const targetDiff =
    diff.find((item) => item.criterionId === preferredCriterionId) ??
    diff.find((item) => item.severity !== 'cosmetic') ??
    diff[0];
  if (!targetDiff) {
    return null;
  }
  const criterion = project.criteria.find((item) => item.id === targetDiff.criterionId);
  if (!criterion) {
    return null;
  }
  const proposedDescription = buildVariantDescription(criterion);
  return {
    branchName: `try/${criterion.id}-variant`,
    criterionId: criterion.id,
    label: criterion.label,
    originalDescription: criterion.description,
    proposedDescription,
    commitMessage: `Try variant for ${criterion.label}`,
    passToFailDelta: targetDiff.severity === 'breaking' ? 2 : 1,
    failToPassDelta: targetDiff.severity === 'cosmetic' ? 0 : 1,
  };
}

export function buildVariantDescription(criterion: Criterion): string {
  const boundary = 'Variant boundary: score only observable evidence in the response, and ignore style differences that do not change criterion satisfaction.';
  return criterion.description.includes('Variant boundary:')
    ? criterion.description
    : `${criterion.description.trim()}\n\n${boundary}`;
}

import type { DiffResult, RubricProject } from './rubric';

export interface VersionComparisonRun {
  id: string;
  baseRef: string;
  targetRef: string;
  sampleCount: number;
  judgeCount: number;
  criteriaChanged: number;
  substantiveChanges: number;
  breakingChanges: number;
  passToFail: number;
  failToPass: number;
  generatedAt: string;
  summary: string;
}

export function normalizeVersionRef(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, '-');
  return normalized || fallback;
}

export function buildVersionComparisonRun({
  project,
  diff,
  baseRef,
  targetRef,
  generatedAt = new Date().toISOString(),
}: {
  project: RubricProject;
  diff: DiffResult[];
  baseRef: string;
  targetRef: string;
  generatedAt?: string;
}): VersionComparisonRun {
  const normalizedBaseRef = normalizeVersionRef(baseRef, 'main');
  const normalizedTargetRef = normalizeVersionRef(targetRef, 'working-tree');
  const criteriaChanged = diff.length;
  const substantiveChanges = diff.filter((item) => item.severity !== 'cosmetic').length;
  const breakingChanges = diff.filter((item) => item.severity === 'breaking').length;
  const passToFail = diff.reduce((sum, item) => sum + item.passToFail, 0);
  const failToPass = diff.reduce((sum, item) => sum + item.failToPass, 0);
  const sampleCount = project.samples.length;
  const judgeCount = project.judges.filter((judge) => judge.enabled).length;
  const id = [
    'overlay',
    project.id,
    normalizedBaseRef,
    normalizedTargetRef,
    stableHash(`${project.id}:${normalizedBaseRef}:${normalizedTargetRef}:${generatedAt}`).toString(36),
  ].join('-');

  return {
    id,
    baseRef: normalizedBaseRef,
    targetRef: normalizedTargetRef,
    sampleCount,
    judgeCount,
    criteriaChanged,
    substantiveChanges,
    breakingChanges,
    passToFail,
    failToPass,
    generatedAt,
    summary: `${normalizedBaseRef} -> ${normalizedTargetRef}: ${substantiveChanges} substantive changes re-scored across ${sampleCount} samples and ${judgeCount} judges.`,
  };
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

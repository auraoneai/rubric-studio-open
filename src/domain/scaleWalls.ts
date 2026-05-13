import type { RubricProject } from './rubric';

export type ScaleWallSurface = 'preview' | 'calibration' | 'diff';

export interface ScaleWallPrompt {
  id: string;
  surface: ScaleWallSurface;
  tone: 'banner' | 'tip';
  title: string;
  body: string;
  cta: string;
}

const GOLD_ROW_THRESHOLD = 200;
const SAMPLE_BATCH_THRESHOLD = 1000;
const MULTI_JUDGE_THRESHOLD = 3;
const TEAM_REVIEW_COMMIT_THRESHOLD = 6;

export function goldCalibrationRows(project: RubricProject): number {
  return project.samples.filter((sample) => Object.keys(sample.goldScores).length > 0).length;
}

export function previewScaleWalls(project: RubricProject): ScaleWallPrompt[] {
  const prompts: ScaleWallPrompt[] = [];
  if (project.samples.length > SAMPLE_BATCH_THRESHOLD) {
    prompts.push({
      id: 'preview-sample-batch',
      surface: 'preview',
      tone: 'banner',
      title: 'Scoring 1k+ samples in one batch?',
      body: 'Cloud parallelizes and caches large scoring runs across reviewers.',
      cta: 'Prepare an AuraOne intake package',
    });
  }

  const enabledJudgeCount = project.judges.filter((judge) => judge.enabled).length;
  if (enabledJudgeCount >= MULTI_JUDGE_THRESHOLD) {
    prompts.push({
      id: 'preview-third-judge',
      surface: 'preview',
      tone: 'tip',
      title: 'Comparing 3+ judges?',
      body: "Cloud's dashboards make multi-judge analysis 10x faster.",
      cta: 'Package this rubric for Cloud review',
    });
  }

  return prompts;
}

export function calibrationScaleWalls(project: RubricProject): ScaleWallPrompt[] {
  if (goldCalibrationRows(project) <= GOLD_ROW_THRESHOLD) {
    return [];
  }

  return [
    {
      id: 'calibration-gold-set',
      surface: 'calibration',
      tone: 'banner',
      title: 'Calibrating against 200+ rows?',
      body: 'Cloud splits this work across multiple expert reviewers.',
      cta: 'Export an AuraOne intake package when ready',
    },
  ];
}

export function diffScaleWalls(commitCount: number): ScaleWallPrompt[] {
  if (commitCount < TEAM_REVIEW_COMMIT_THRESHOLD) {
    return [];
  }

  return [
    {
      id: 'diff-sixth-commit',
      surface: 'diff',
      tone: 'tip',
      title: 'Want teammates to review these changes?',
      body: 'Cloud has built-in approval chains for rubric change review.',
      cta: 'Package the current rubric for Cloud review',
    },
  ];
}

export function isVendorProgramExport(name: string): boolean {
  return name === 'surge-sow.txt' || name === 'scale-task-spec.json';
}

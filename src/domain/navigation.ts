export type Tab = 'authoring' | 'preview' | 'calibration' | 'diff' | 'export' | 'settings';

export interface TourStep {
  tab: Tab;
  title: string;
  body: string;
  outcome: string;
}

export const tabs: Array<{ id: Tab; label: string; action: string }> = [
  { id: 'authoring', label: 'Author', action: 'Switch to Authoring' },
  { id: 'preview', label: 'Preview', action: 'Switch to Preview' },
  { id: 'calibration', label: 'Calibrate', action: 'Switch to Calibration' },
  { id: 'diff', label: 'Diff', action: 'Switch to Diff' },
  { id: 'export', label: 'Export', action: 'Switch to Export' },
  { id: 'settings', label: 'Settings', action: 'Switch to Settings' },
];

export const tourSteps: TourStep[] = [
  {
    tab: 'authoring',
    title: 'Author criteria like code',
    body: 'Start in the criterion tree, edit rubric-spec fields, use autocomplete, and keep validation signals visible while you write.',
    outcome: 'You leave with a valid project structure on disk.',
  },
  {
    tab: 'preview',
    title: 'Test against samples immediately',
    body: 'Load held-out examples, score with the local mock judge or BYO providers, and inspect what each criterion caught.',
    outcome: 'You see pass, partial, and fail behavior before the rubric leaves your machine.',
  },
  {
    tab: 'calibration',
    title: 'Calibrate against expert scores',
    body: 'Load gold labels, review IAA metrics, identify low-agreement criteria, and stage rewrite suggestions.',
    outcome: 'You know which criteria need another authoring pass.',
  },
  {
    tab: 'diff',
    title: 'Review semantic drift locally',
    body: 'Compare wording and deterministic fixture impact with a saved local checkpoint, then apply variants only when the changed behavior is clear.',
    outcome: 'Rubric changes become reviewable, reproducible diffs.',
  },
  {
    tab: 'export',
    title: 'Ship portable artifacts',
    body: 'Export rubric files, judge cards, eval manifests, conformance badges, CI helpers, and an unsigned local evidence ZIP.',
    outcome: 'The same rubric can move to OSS runners, papers, or expert review.',
  },
  {
    tab: 'settings',
    title: 'Keep trust controls visible',
    body: 'Review BYO key storage, transparent telemetry, default-off crash reporting, update status, shortcuts, and high contrast.',
    outcome: 'Local-first behavior and reporting choices stay inspectable.',
  },
];

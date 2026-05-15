import type { ShortcutRow } from './shortcuts';

export type StudioActionCategory =
  | 'authoring'
  | 'navigation'
  | 'onboarding'
  | 'preview'
  | 'calibration'
  | 'diff'
  | 'export'
  | 'git'
  | 'settings'
  | 'surface';

export interface StudioActionDefinition {
  label: string;
  category: StudioActionCategory;
  defaultShortcut: string;
}

export const studioActions: StudioActionDefinition[] = [
  { label: 'Command palette', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-K' },
  { label: 'Start guided tour', category: 'onboarding', defaultShortcut: 'Cmd/Ctrl-Alt-T' },
  { label: 'New criterion', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-N' },
  { label: 'New theme', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-Shift-N' },
  { label: 'Duplicate criterion', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-D' },
  { label: 'Delete criterion', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-Backspace' },
  { label: 'Find in current criterion', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-F' },
  { label: 'Find across project', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-Shift-F' },
  { label: 'Save current project', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-S' },
  { label: 'New project from template', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-Alt-N' },
  { label: 'Quick open', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-P' },
  { label: 'Run preview', category: 'preview', defaultShortcut: 'Cmd/Ctrl-R' },
  { label: 'Score current sample', category: 'preview', defaultShortcut: 'Cmd/Ctrl-Enter' },
  { label: 'Score all samples', category: 'preview', defaultShortcut: 'Cmd/Ctrl-Shift-Enter' },
  { label: 'Toggle comments', category: 'authoring', defaultShortcut: 'Cmd/Ctrl-/' },
  { label: 'Open calibration', category: 'calibration', defaultShortcut: 'Cmd/Ctrl-Alt-C' },
  { label: 'Run bias probes', category: 'calibration', defaultShortcut: 'Cmd/Ctrl-Shift-B' },
  { label: 'Run contamination audit', category: 'calibration', defaultShortcut: 'Cmd/Ctrl-Shift-A' },
  { label: 'Open semantic diff', category: 'diff', defaultShortcut: 'Cmd/Ctrl-Alt-D' },
  { label: 'Try criterion variant', category: 'diff', defaultShortcut: 'Cmd/Ctrl-Shift-V' },
  { label: 'Export: lm-eval-harness', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-1' },
  { label: 'Export: Inspect', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-2' },
  { label: 'Export: OpenAI Evals', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-3' },
  { label: 'Export: Promptfoo', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-4' },
  { label: 'Export: AuraOne intake package', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-5' },
  { label: 'Generate CI helper', category: 'export', defaultShortcut: 'Cmd/Ctrl-Alt-6' },
  { label: 'Git init', category: 'git', defaultShortcut: 'Cmd/Ctrl-G' },
  { label: 'Git commit', category: 'git', defaultShortcut: 'Cmd/Ctrl-Shift-G' },
  { label: 'Open keyboard shortcuts', category: 'settings', defaultShortcut: 'Cmd/Ctrl-,' },
  { label: 'Switch to Authoring', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-1' },
  { label: 'Switch to Preview', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-2' },
  { label: 'Switch to Calibration', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-3' },
  { label: 'Switch to Diff', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-4' },
  { label: 'Switch to Export', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-5' },
  { label: 'Switch to Settings', category: 'navigation', defaultShortcut: 'Cmd/Ctrl-6' },
  { label: 'Toggle browser constraints', category: 'surface', defaultShortcut: 'Cmd/Ctrl-Shift-M' },
];

export function studioActionLabels(): string[] {
  return studioActions.map((action) => action.label);
}

export function defaultShortcutRows(): ShortcutRow[] {
  return studioActions.map((action) => [action.defaultShortcut, action.label]);
}

export function studioActionCategory(label: string): StudioActionCategory {
  return studioActions.find((action) => action.label === label)?.category ?? 'authoring';
}

export function auditStudioActions(shortcuts: ShortcutRow[] = defaultShortcutRows()): {
  duplicateLabels: string[];
  missingShortcutLabels: string[];
  unknownShortcutLabels: string[];
} {
  const labels = studioActionLabels();
  const labelCounts = labels.reduce<Record<string, number>>((counts, label) => {
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const shortcutLabels = shortcuts.map(([, label]) => label);
  return {
    duplicateLabels: Object.entries(labelCounts)
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
    missingShortcutLabels: labels.filter((label) => !shortcutLabels.includes(label)),
    unknownShortcutLabels: shortcutLabels.filter((label) => !labels.includes(label)),
  };
}

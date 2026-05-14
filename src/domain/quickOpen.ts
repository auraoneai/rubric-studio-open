import type { RecentProject } from './projectOpen';
import type { RubricProject, SurfaceMode } from './rubric';

export type QuickOpenKind =
  | 'criterion'
  | 'theme'
  | 'sample'
  | 'judge'
  | 'export'
  | 'git'
  | 'recent-project'
  | 'project-folder';

export interface QuickOpenItem {
  id: string;
  kind: QuickOpenKind;
  label: string;
  path: string;
  detail: string;
  targetId?: string;
  artifactName?: string;
}

export function buildQuickOpenItems({
  project,
  exports,
  recentProjects,
  surface,
  openedProjectPath,
}: {
  project: RubricProject;
  exports: Record<string, string>;
  recentProjects: RecentProject[];
  surface: SurfaceMode;
  openedProjectPath: string | null;
}): QuickOpenItem[] {
  const themeLabels = new Map(project.themes.map((theme) => [theme.id, theme.label]));
  return [
    {
      id: 'project-folder',
      kind: 'project-folder',
      label: surface === 'browser' ? 'Import project bundle' : 'Open project folder',
      path: surface === 'browser' ? 'browser-project-import' : openedProjectPath ?? '~/rubrics/',
      detail: surface === 'browser' ? 'Browser edition imports project JSON bundles.' : 'Open a rubric folder from disk.',
    },
    ...recentProjects.map((recent) => ({
      id: `recent:${recent.path}`,
      kind: 'recent-project' as const,
      label: recent.name,
      path: recent.path,
      detail: `Recent project opened ${new Date(recent.lastOpenedAt).toLocaleDateString()}`,
    })),
    ...project.themes.map((theme) => ({
      id: `theme:${theme.id}`,
      kind: 'theme' as const,
      label: theme.label,
      path: `themes/${theme.id}.md`,
      detail: 'Theme description',
      targetId: theme.id,
    })),
    ...project.criteria.map((criterion) => ({
      id: `criterion:${criterion.id}`,
      kind: 'criterion' as const,
      label: criterion.label,
      path: `criteria/${criterion.themeId}/${criterion.id}.toml`,
      detail: `${themeLabels.get(criterion.themeId) ?? criterion.themeId} criterion`,
      targetId: criterion.id,
    })),
    ...project.samples.map((sample) => ({
      id: `sample:${sample.id}`,
      kind: 'sample' as const,
      label: sample.id,
      path: `samples/${sample.id}.jsonl`,
      detail: 'Sample row',
      targetId: sample.id,
    })),
    ...project.judges.map((judge) => ({
      id: `judge:${judge.id}`,
      kind: 'judge' as const,
      label: judge.label,
      path: `judges/${judge.id}.toml`,
      detail: `${judge.provider} judge`,
      targetId: judge.id,
    })),
    ...Object.keys(exports).map((name) => ({
      id: `export:${name}`,
      kind: 'export' as const,
      label: name,
      path: `exports/${name.replace(/^\./, '')}`,
      detail: 'Generated export artifact',
      artifactName: name,
    })),
    {
      id: 'git-status',
      kind: 'git',
      label: `.git/ ${project.branch}`,
      path: '.git/',
      detail: 'Local git status and semantic diff',
    },
  ];
}

export function filterQuickOpenItems(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return items;
  }
  return items.filter((item) =>
    [item.label, item.path, item.detail, item.kind].some((value) => value.toLowerCase().includes(needle)),
  );
}

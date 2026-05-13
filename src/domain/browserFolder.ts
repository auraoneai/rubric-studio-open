import type { RubricProject } from './rubric';

export interface BrowserFolderArtifact {
  path: string;
  content: string;
  type: string;
}

export function browserFolderArtifacts(project: RubricProject, exportedAt = new Date()): BrowserFolderArtifact[] {
  const bundle = {
    schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
    exportedAt: exportedAt.toISOString(),
    project,
  };
  return [
    {
      path: 'project-bundle.json',
      content: JSON.stringify(bundle, null, 2),
      type: 'application/json',
    },
    {
      path: 'rubric.json',
      content: JSON.stringify(project, null, 2),
      type: 'application/json',
    },
    {
      path: 'samples/samples.json',
      content: JSON.stringify(project.samples, null, 2),
      type: 'application/json',
    },
    ...project.criteria.map((criterion) => ({
      path: `criteria/${criterion.id}.json`,
      content: JSON.stringify(criterion, null, 2),
      type: 'application/json',
    })),
  ];
}

export function projectFromBrowserFolder(files: Record<string, string>): RubricProject | null {
  const bundle = parseJson<{ project?: RubricProject }>(files['project-bundle.json']);
  if (bundle?.project) {
    return bundle.project;
  }
  return parseJson<RubricProject>(files['rubric.json']);
}

function parseJson<T>(value: string | undefined): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

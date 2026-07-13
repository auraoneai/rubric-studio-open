import type { RubricProject } from './rubric';

interface StoredCheckpoint {
  schemaVersion: 'rubric-studio-checkpoint.v1';
  savedAt: string;
  project: RubricProject;
}

export function readLocalCheckpoint(project: RubricProject): RubricProject {
  try {
    const stored = localStorage.getItem(checkpointKey(project.id));
    if (!stored) return cloneProject(project);
    const parsed = JSON.parse(stored) as Partial<StoredCheckpoint>;
    if (
      parsed.schemaVersion !== 'rubric-studio-checkpoint.v1' ||
      parsed.project?.id !== project.id ||
      !Array.isArray(parsed.project.criteria)
    ) {
      return cloneProject(project);
    }
    return cloneProject(parsed.project);
  } catch {
    return cloneProject(project);
  }
}

export function saveLocalCheckpoint(project: RubricProject): { savedAt: string; project: RubricProject } {
  const checkpoint: StoredCheckpoint = {
    schemaVersion: 'rubric-studio-checkpoint.v1',
    savedAt: new Date().toISOString(),
    project: cloneProject(project),
  };
  localStorage.setItem(checkpointKey(project.id), JSON.stringify(checkpoint));
  return { savedAt: checkpoint.savedAt, project: checkpoint.project };
}

export function cloneProject(project: RubricProject): RubricProject {
  return JSON.parse(JSON.stringify(project)) as RubricProject;
}

function checkpointKey(projectId: string): string {
  return `rso:checkpoint:${projectId}`;
}

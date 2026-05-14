import type { RubricProject } from './rubric';

export interface CrdtCriterionRecord {
  id: string;
  label: string;
  hash: string;
  clock: Record<string, number>;
  readOnly: true;
}

export interface ReadOnlyCrdtSnapshot {
  schema: 'auraone.rubric-studio-open.crdt-snapshot.v1';
  projectId: string;
  projectVersion: string;
  actorId: string;
  createdAt: string;
  mode: 'read-only';
  vectorClock: Record<string, number>;
  criteria: CrdtCriterionRecord[];
}

export interface CrdtSnapshotSummary {
  valid: boolean;
  readOnly: boolean;
  participants: string[];
  changedCriteria: string[];
  missingCriteria: string[];
  extraCriteria: string[];
  message: string;
}

export function buildReadOnlyCrdtSnapshot(
  project: RubricProject,
  actorId = 'local-author',
  createdAt = new Date().toISOString(),
): ReadOnlyCrdtSnapshot {
  const safeActorId = normalizeActorId(actorId);
  return {
    schema: 'auraone.rubric-studio-open.crdt-snapshot.v1',
    projectId: project.id,
    projectVersion: project.version,
    actorId: safeActorId,
    createdAt,
    mode: 'read-only',
    vectorClock: {
      [safeActorId]: project.criteria.length + project.themes.length + project.samples.length,
    },
    criteria: project.criteria.map((criterion, index) => ({
      id: criterion.id,
      label: criterion.label,
      hash: criterionHash(project.id, criterion),
      clock: { [safeActorId]: index + 1 },
      readOnly: true,
    })),
  };
}

export function parseReadOnlyCrdtSnapshot(text: string): ReadOnlyCrdtSnapshot | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isReadOnlyCrdtSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeReadOnlyCrdtSnapshot(
  project: RubricProject,
  snapshot: ReadOnlyCrdtSnapshot | null,
): CrdtSnapshotSummary {
  if (!snapshot) {
    return {
      valid: false,
      readOnly: false,
      participants: [],
      changedCriteria: [],
      missingCriteria: [],
      extraCriteria: [],
      message: 'Snapshot is not valid Rubric Studio Open CRDT JSON.',
    };
  }
  if (snapshot.projectId !== project.id) {
    return {
      valid: false,
      readOnly: snapshot.mode === 'read-only',
      participants: Object.keys(snapshot.vectorClock),
      changedCriteria: [],
      missingCriteria: [],
      extraCriteria: [],
      message: `Snapshot targets ${snapshot.projectId}, not ${project.id}.`,
    };
  }

  const currentById = new Map(project.criteria.map((criterion) => [criterion.id, criterion]));
  const snapshotById = new Map(snapshot.criteria.map((criterion) => [criterion.id, criterion]));
  const changedCriteria = snapshot.criteria
    .filter((criterion) => {
      const current = currentById.get(criterion.id);
      return current ? criterion.hash !== criterionHash(project.id, current) : false;
    })
    .map((criterion) => criterion.label);
  const missingCriteria = project.criteria
    .filter((criterion) => !snapshotById.has(criterion.id))
    .map((criterion) => criterion.label);
  const extraCriteria = snapshot.criteria
    .filter((criterion) => !currentById.has(criterion.id))
    .map((criterion) => criterion.label);
  const participants = Array.from(new Set([snapshot.actorId, ...Object.keys(snapshot.vectorClock)])).sort();
  const changedCount = changedCriteria.length + missingCriteria.length + extraCriteria.length;

  return {
    valid: true,
    readOnly: snapshot.mode === 'read-only' && snapshot.criteria.every((criterion) => criterion.readOnly === true),
    participants,
    changedCriteria,
    missingCriteria,
    extraCriteria,
    message:
      changedCount === 0
        ? `Read-only snapshot is current for ${participants.length} participant${participants.length === 1 ? '' : 's'}.`
        : `Read-only snapshot has ${changedCount} review difference${changedCount === 1 ? '' : 's'}.`,
  };
}

function isReadOnlyCrdtSnapshot(value: unknown): value is ReadOnlyCrdtSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ReadOnlyCrdtSnapshot>;
  return (
    candidate.schema === 'auraone.rubric-studio-open.crdt-snapshot.v1' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.projectVersion === 'string' &&
    typeof candidate.actorId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    candidate.mode === 'read-only' &&
    isNumberRecord(candidate.vectorClock) &&
    Array.isArray(candidate.criteria) &&
    candidate.criteria.every(isCrdtCriterionRecord)
  );
}

function isCrdtCriterionRecord(value: unknown): value is CrdtCriterionRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CrdtCriterionRecord>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.hash === 'string' &&
    candidate.readOnly === true &&
    isNumberRecord(candidate.clock)
  );
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => Number.isFinite(entry));
}

function criterionHash(projectId: string, criterion: RubricProject['criteria'][number]): string {
  return stableHash([
    projectId,
    criterion.id,
    criterion.label,
    criterion.themeId,
    criterion.description,
    criterion.weight,
    criterion.scale,
    criterion.status,
    criterion.positiveExamples.join('|'),
    criterion.negativeExamples.join('|'),
    criterion.boundaries,
    criterion.tags.join('|'),
  ].join('\u001f')).toString(16).padStart(8, '0');
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeActorId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'local-author';
}

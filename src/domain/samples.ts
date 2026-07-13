import type { RubricProject, RubricSample } from './rubric';

export interface GoldImportResult {
  samples: RubricSample[];
  importedRows: number;
  labeledDecisions: number;
}

export function parseJsonlSamples(text: string, project: RubricProject): RubricSample[] {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return rows.map((row, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch {
      throw new Error(`JSONL row ${index + 1} is not valid JSON.`);
    }
    if (!isSampleShape(parsed)) {
      throw new Error(`JSONL row ${index + 1} must include id, prompt, and response fields.`);
    }
    return {
      id: parsed.id.trim(),
      prompt: parsed.prompt.trim(),
      response: parsed.response.trim(),
      metadata: isMetadata(parsed.metadata) ? parsed.metadata : { source: 'jsonl' },
      goldScores: isGoldScores(parsed.goldScores) ? parsed.goldScores : {},
    };
  });
}

export function parseScratchSamples(text: string, project: RubricProject, idSeed = Date.now()): RubricSample[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines.length > 1 ? lines : [text.trim()];

  return candidates.map((candidate, index) => {
    try {
      const parsed = JSON.parse(candidate) as Partial<RubricSample>;
      return {
        id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : `scratch-${idSeed}-${index + 1}`,
        prompt: typeof parsed.prompt === 'string' && parsed.prompt.trim() ? parsed.prompt.trim() : 'Scratch sample',
        response: typeof parsed.response === 'string' && parsed.response.trim() ? parsed.response.trim() : candidate,
        metadata: isMetadata(parsed.metadata) ? parsed.metadata : { source: 'paste' },
        goldScores: isGoldScores(parsed.goldScores) ? parsed.goldScores : {},
      };
    } catch {
      return {
        id: `scratch-${idSeed}-${index + 1}`,
        prompt: 'Scratch sample',
        response: candidate,
        metadata: { source: 'paste' },
        goldScores: {},
      };
    }
  });
}

export function parseGoldJsonl(text: string, project: RubricProject): GoldImportResult {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rows.length === 0) {
    throw new Error('Gold JSONL is empty.');
  }

  const criterionIds = new Set(project.criteria.map((criterion) => criterion.id));
  const samplesById = new Map(project.samples.map((sample) => [sample.id, { ...sample, goldScores: { ...sample.goldScores } }]));
  let labeledDecisions = 0;

  rows.forEach((row, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch {
      throw new Error(`Gold JSONL row ${index + 1} is not valid JSON.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Gold JSONL row ${index + 1} must be an object.`);
    }
    const candidate = parsed as Record<string, unknown>;
    const sampleId =
      typeof candidate.sampleId === 'string'
        ? candidate.sampleId.trim()
        : typeof candidate.id === 'string'
          ? candidate.id.trim()
          : '';
    if (!sampleId) {
      throw new Error(`Gold JSONL row ${index + 1} must include sampleId or id.`);
    }
    const scores = isGoldScores(candidate.goldScores)
      ? candidate.goldScores
      : isGoldScores(candidate.scores)
        ? candidate.scores
        : null;
    if (!scores || Object.keys(scores).length === 0) {
      throw new Error(`Gold JSONL row ${index + 1} must include non-empty scores or goldScores.`);
    }
    for (const [criterionId, score] of Object.entries(scores)) {
      if (!criterionIds.has(criterionId)) {
        throw new Error(`Gold JSONL row ${index + 1} references unknown criterion ${criterionId}.`);
      }
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        throw new Error(`Gold JSONL row ${index + 1} score for ${criterionId} must be between 0 and 1.`);
      }
      labeledDecisions += 1;
    }

    const existing = samplesById.get(sampleId);
    if (existing) {
      samplesById.set(sampleId, {
        ...existing,
        goldScores: { ...existing.goldScores, ...scores },
      });
      return;
    }
    if (!isSampleShape(candidate)) {
      throw new Error(
        `Gold JSONL row ${index + 1} references new sample ${sampleId}; include id, prompt, and response to add it.`,
      );
    }
    samplesById.set(sampleId, {
      id: sampleId,
      prompt: candidate.prompt.trim(),
      response: candidate.response.trim(),
      metadata: isMetadata(candidate.metadata) ? candidate.metadata : { source: 'gold-jsonl' },
      goldScores: { ...scores },
    });
  });

  return {
    samples: [...samplesById.values()],
    importedRows: rows.length,
    labeledDecisions,
  };
}

export function defaultGoldScores(project: RubricProject): Record<string, number> {
  return Object.fromEntries(project.criteria.map((criterion, index) => [criterion.id, index % 2 === 0 ? 1 : 0.5]));
}

function isSampleShape(value: unknown): value is Pick<RubricSample, 'id' | 'prompt' | 'response'> & Partial<RubricSample> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<RubricSample>;
  return hasText(candidate.id) && hasText(candidate.prompt) && hasText(candidate.response);
}

function isMetadata(value: unknown): value is RubricSample['metadata'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => ['string', 'number', 'boolean'].includes(typeof entry));
}

function isGoldScores(value: unknown): value is RubricSample['goldScores'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

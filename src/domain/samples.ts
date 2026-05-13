import type { RubricProject, RubricSample } from './rubric';

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
      goldScores: isGoldScores(parsed.goldScores) ? parsed.goldScores : defaultGoldScores(project),
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
        goldScores: isGoldScores(parsed.goldScores) ? parsed.goldScores : defaultGoldScores(project),
      };
    } catch {
      return {
        id: `scratch-${idSeed}-${index + 1}`,
        prompt: 'Scratch sample',
        response: candidate,
        metadata: { source: 'paste' },
        goldScores: defaultGoldScores(project),
      };
    }
  });
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
  return Object.values(value).every((entry) => Number.isFinite(entry));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

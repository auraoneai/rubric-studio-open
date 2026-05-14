import type { RubricProject, RubricSample, SurfaceMode } from './rubric';

export interface GoldSetCoverageIssue {
  sampleId: string;
  missingCriterionIds: string[];
}

export interface GoldSetCoverageRow {
  criterionId: string;
  scoredRows: number;
  coverage: number;
}

export interface GoldSetImportSummary {
  totalRows: number;
  completeRows: number;
  missingScoreRows: GoldSetCoverageIssue[];
  coverageByCriterion: GoldSetCoverageRow[];
  warnings: string[];
}

export interface GoldSetImportResult {
  samples: RubricSample[];
  summary: GoldSetImportSummary;
}

export function generateSyntheticTestSample(
  project: RubricProject,
  surface: SurfaceMode,
  idSeed = Date.now(),
): RubricSample {
  return {
    id: `synthetic-${idSeed}`,
    prompt: 'Generate a compact answer that exercises this rubric across safety, evidence, uncertainty, and helpfulness.',
    response:
      'This generated test response gives concrete steps, names uncertainty, cites where evidence is missing, includes reproducible checks, and refuses unsafe requests with a safe alternative.',
    metadata: {
      source: 'synthetic-meta-prompt',
      surface,
      synthetic: true,
      meta_prompt: 'Generate a sample response for testing rubric criteria across pass, partial, and fail boundaries.',
    },
    goldScores: defaultGoldScores(project),
  };
}

export function parseJsonlSamples(text: string, project: RubricProject): RubricSample[] {
  return parseJsonlRows(text, project, 'jsonl', true);
}

export function parseGoldSetJsonl(text: string, project: RubricProject): GoldSetImportResult {
  const samples = parseJsonlRows(text, project, 'gold-set', false);
  return {
    samples,
    summary: summarizeGoldSetCoverage(project, samples),
  };
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

export function summarizeGoldSetCoverage(
  project: RubricProject,
  samples: RubricSample[],
): GoldSetImportSummary {
  const criterionIds = project.criteria.map((criterion) => criterion.id);
  const missingScoreRows = samples
    .map((sample) => ({
      sampleId: sample.id,
      missingCriterionIds: criterionIds.filter((criterionId) => sample.goldScores[criterionId] === undefined),
    }))
    .filter((row) => row.missingCriterionIds.length > 0);
  const coverageByCriterion = criterionIds.map((criterionId) => {
    const scoredRows = samples.filter((sample) => sample.goldScores[criterionId] !== undefined).length;
    return {
      criterionId,
      scoredRows,
      coverage: samples.length === 0 ? 0 : Number((scoredRows / samples.length).toFixed(2)),
    };
  });
  const lowCoverage = coverageByCriterion.filter((row) => row.coverage < 0.8);
  const warnings = [
    ...missingScoreRows.slice(0, 3).map((row) =>
      `${row.sampleId} is missing ${row.missingCriterionIds.length} criterion score${row.missingCriterionIds.length === 1 ? '' : 's'}.`,
    ),
    ...lowCoverage.slice(0, 3).map((row) =>
      `${row.criterionId} has ${Math.round(row.coverage * 100)}% gold coverage.`,
    ),
  ];

  return {
    totalRows: samples.length,
    completeRows: samples.length - missingScoreRows.length,
    missingScoreRows,
    coverageByCriterion,
    warnings,
  };
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

function parseJsonlRows(
  text: string,
  project: RubricProject,
  source: string,
  defaultMissingScores: boolean,
): RubricSample[] {
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
    const scores = scoresFromParsedRow(parsed);
    return {
      id: parsed.id.trim(),
      prompt: parsed.prompt.trim(),
      response: parsed.response.trim(),
      metadata: isMetadata(parsed.metadata) ? parsed.metadata : { source },
      goldScores: scores ?? (defaultMissingScores ? defaultGoldScores(project) : {}),
    };
  });
}

function scoresFromParsedRow(value: unknown): RubricSample['goldScores'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as {
    goldScores?: unknown;
    humanScores?: unknown;
    scores?: unknown;
  };
  if (isGoldScores(row.goldScores)) {
    return row.goldScores;
  }
  if (isGoldScores(row.humanScores)) {
    return row.humanScores;
  }
  if (isGoldScores(row.scores)) {
    return row.scores;
  }
  return null;
}

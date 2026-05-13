import type { RubricProject, ScoreResult } from './rubric';

export type CatchSort = 'confidence' | 'agreement' | 'score-delta';

export interface CatchViewRow {
  sampleId: string;
  verdict: ScoreResult['verdict'];
  confidence: number;
  agreement: number;
  scoreDelta: number;
  reasoning: string;
}

export function catchViewRows(
  project: RubricProject,
  results: ScoreResult[],
  criterionId: string,
  sort: CatchSort,
): CatchViewRow[] {
  const rows = project.samples
    .map((sample) => {
      const sampleResults = results.filter(
        (result) => result.sampleId === sample.id && result.criterionId === criterionId,
      );
      if (sampleResults.length === 0) {
        return null;
      }
      const verdictCounts = countVerdicts(sampleResults);
      const primary = sampleResults.slice().sort((a, b) => b.confidence - a.confidence)[0];
      const scores = sampleResults.map((result) => result.score);
      return {
        sampleId: sample.id,
        verdict: primary.verdict,
        confidence: primary.confidence,
        agreement: Math.max(...Object.values(verdictCounts)) / sampleResults.length,
        scoreDelta: Math.max(...scores) - Math.min(...scores),
        reasoning: sampleResults.map((result) => `${result.judgeId}: ${result.reasoning}`).join('\n\n'),
      };
    })
    .filter((row): row is CatchViewRow => Boolean(row));

  return rows.sort((a, b) => {
    if (sort === 'agreement') {
      return a.agreement - b.agreement || b.scoreDelta - a.scoreDelta;
    }
    if (sort === 'score-delta') {
      return b.scoreDelta - a.scoreDelta || a.agreement - b.agreement;
    }
    return a.confidence - b.confidence || b.scoreDelta - a.scoreDelta;
  });
}

function countVerdicts(results: ScoreResult[]): Record<ScoreResult['verdict'], number> {
  return results.reduce(
    (counts, result) => {
      counts[result.verdict] += 1;
      return counts;
    },
    { pass: 0, partial: 0, fail: 0 },
  );
}

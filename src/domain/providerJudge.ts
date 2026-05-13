import type { Criterion, JudgeConfig, RubricSample, ScoreResult } from './rubric';

export type RemoteJudgeProvider = 'openai' | 'anthropic' | 'google';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function isRemoteJudge(judge: JudgeConfig): judge is JudgeConfig & { provider: RemoteJudgeProvider } {
  return judge.provider === 'openai' || judge.provider === 'anthropic' || judge.provider === 'google';
}

export function buildProviderScoringPrompt(criterion: Criterion, sample: RubricSample): string {
  return [
    'You are a Rubric Studio Open judge. Score one model response against one criterion.',
    'Return only JSON with verdict, confidence, and reasoning. Verdict must be pass, partial, or fail.',
    '',
    `Criterion: ${criterion.label}`,
    `Description: ${criterion.description}`,
    `Scale: ${criterion.scale}`,
    `Positive examples: ${criterion.positiveExamples.join(' | ')}`,
    `Negative examples: ${criterion.negativeExamples.join(' | ')}`,
    `Boundaries: ${criterion.boundaries || 'none'}`,
    '',
    `Prompt: ${sample.prompt}`,
    `Response: ${sample.response}`,
  ].join('\n');
}

export async function scoreProviderCriterion({
  judge,
  criterion,
  sample,
  apiKey,
  fetcher = fetch,
}: {
  judge: JudgeConfig & { provider: RemoteJudgeProvider };
  criterion: Criterion;
  sample: RubricSample;
  apiKey: string;
  fetcher?: FetchLike;
}): Promise<ScoreResult> {
  const prompt = buildProviderScoringPrompt(criterion, sample);
  const response = await fetcher(providerEndpoint(judge), providerRequest(judge, apiKey, prompt));
  if (!response.ok) {
    throw new Error(`${judge.provider} judge returned ${response.status}`);
  }
  const payload = await response.json();
  return parseProviderScore(judge.id, criterion.id, sample.id, providerText(judge.provider, payload));
}

export function parseProviderScore(
  judgeId: string,
  criterionId: string,
  sampleId: string,
  text: string,
): ScoreResult {
  const parsed = parseScoreJson(text);
  const verdict = normalizeVerdict(parsed?.verdict, text);
  const confidence = normalizeConfidence(parsed?.confidence);
  return {
    criterionId,
    judgeId,
    sampleId,
    verdict,
    score: verdict === 'pass' ? 0.84 : verdict === 'partial' ? 0.56 : 0.22,
    confidence,
    reasoning: parsed?.reasoning?.trim() || text.trim() || 'Provider returned an empty reasoning trace.',
  };
}

function providerEndpoint(judge: JudgeConfig & { provider: RemoteJudgeProvider }): string {
  if (judge.provider === 'openai') return 'https://api.openai.com/v1/responses';
  if (judge.provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(judge.model)}:generateContent`;
}

function providerRequest(judge: JudgeConfig & { provider: RemoteJudgeProvider }, apiKey: string, prompt: string): RequestInit {
  if (judge.provider === 'openai') {
    return {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: judge.model,
        input: prompt,
        temperature: 0,
      }),
    };
  }
  if (judge.provider === 'anthropic') {
    return {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: judge.model,
        max_tokens: 700,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    };
  }
  return {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generationConfig: { temperature: 0 },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  };
}

function providerText(provider: RemoteJudgeProvider, payload: unknown): string {
  const value = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    content?: Array<{ text?: string }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (provider === 'openai') {
    return value.output_text ?? value.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('\n') ?? '';
  }
  if (provider === 'anthropic') {
    return value.content?.map((item) => item.text ?? '').join('\n') ?? '';
  }
  return value.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? '').join('\n') ?? '';
}

function parseScoreJson(text: string): { verdict?: string; confidence?: number; reasoning?: string } | null {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    return JSON.parse(jsonText) as { verdict?: string; confidence?: number; reasoning?: string };
  } catch {
    return null;
  }
}

function normalizeVerdict(value: string | undefined, fallbackText: string): ScoreResult['verdict'] {
  const text = `${value ?? ''} ${fallbackText}`.toLowerCase();
  if (text.includes('fail')) return 'fail';
  if (text.includes('partial')) return 'partial';
  return 'pass';
}

function normalizeConfidence(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.72;
  }
  return Number(Math.min(1, Math.max(0, value ?? 0.72)).toFixed(2));
}

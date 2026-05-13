import type { Criterion, RubricSample, ScoreResult } from './rubric';

export interface OllamaModel {
  name: string;
  modified_at?: string;
}

export interface OllamaStatus {
  detected: boolean;
  endpoint: string;
  models: OllamaModel[];
  recommendedModel: string;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OLLAMA_ENDPOINT = 'http://localhost:11434';
const RECOMMENDED_MODEL = 'llama3.1:8b';

export async function detectOllama(fetcher: FetchLike = fetch): Promise<OllamaStatus> {
  const response = await fetcher(`${OLLAMA_ENDPOINT}/api/tags`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }
  const payload = (await response.json()) as { models?: OllamaModel[] };
  return {
    detected: true,
    endpoint: OLLAMA_ENDPOINT,
    models: payload.models ?? [],
    recommendedModel: RECOMMENDED_MODEL,
  };
}

export function buildOllamaScoringPrompt(criterion: Criterion, sample: RubricSample): string {
  return [
    'You are Rubric Studio Open local judge. Score the sample against exactly one criterion.',
    'Return a short JSON object with verdict, confidence, and reasoning. Use verdict pass, partial, or fail.',
    '',
    `Criterion: ${criterion.label}`,
    `Description: ${criterion.description}`,
    `Positive examples: ${criterion.positiveExamples.join(' | ')}`,
    `Negative examples: ${criterion.negativeExamples.join(' | ')}`,
    `Prompt: ${sample.prompt}`,
    `Response: ${sample.response}`,
  ].join('\n');
}

export async function streamOllamaCriterionScore({
  model,
  criterion,
  sample,
  onToken,
  fetcher = fetch,
}: {
  model: string;
  criterion: Criterion;
  sample: RubricSample;
  onToken: (token: string) => void;
  fetcher?: FetchLike;
}): Promise<ScoreResult> {
  const response = await fetcher(`${OLLAMA_ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildOllamaScoringPrompt(criterion, sample),
      stream: true,
      options: { temperature: 0 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama scoring returned ${response.status}`);
  }

  const reasoning = response.body
    ? await readOllamaStream(response.body, onToken)
    : await readOllamaJson(response, onToken);

  return deriveScoreFromOllamaText(criterion.id, sample.id, reasoning);
}

export function deriveScoreFromOllamaText(
  criterionId: string,
  sampleId: string,
  reasoning: string,
): ScoreResult {
  const text = reasoning.toLowerCase();
  const verdict = text.includes('"fail"') || text.includes('verdict: fail') || text.includes(' fail')
    ? 'fail'
    : text.includes('"partial"') || text.includes('verdict: partial') || text.includes(' partial')
      ? 'partial'
      : 'pass';
  const confidenceMatch = text.match(/confidence["': ]+([0-9.]+)/);
  const confidence = confidenceMatch ? Math.min(1, Number(confidenceMatch[1])) : 0.74;
  const score = verdict === 'pass' ? 0.82 : verdict === 'partial' ? 0.55 : 0.24;
  return {
    criterionId,
    judgeId: 'ollama-local',
    sampleId,
    verdict,
    score,
    confidence: Number(confidence.toFixed(2)),
    reasoning: reasoning.trim() || 'Ollama returned an empty local trace.',
  };
}

async function readOllamaStream(body: ReadableStream<Uint8Array>, onToken: (token: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoning = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const token = parseOllamaLine(line);
      if (token) {
        reasoning += token;
        onToken(token);
      }
    }
  }
  const finalToken = parseOllamaLine(buffer);
  if (finalToken) {
    reasoning += finalToken;
    onToken(finalToken);
  }
  return reasoning;
}

async function readOllamaJson(response: Response, onToken: (token: string) => void): Promise<string> {
  const payload = (await response.json()) as { response?: string };
  const token = payload.response ?? '';
  onToken(token);
  return token;
}

function parseOllamaLine(line: string): string {
  if (!line.trim()) {
    return '';
  }
  try {
    const payload = JSON.parse(line) as { response?: string };
    return payload.response ?? '';
  } catch {
    return '';
  }
}

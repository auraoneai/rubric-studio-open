import { scoreSamples } from './engine';
import type { Criterion, RubricProject, RubricSample, ScoreResult, SurfaceMode } from './rubric';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeScoreOutput {
  criterion_id: string;
  judge_id: string;
  sample_id: string;
  verdict: ScoreResult['verdict'];
  score: number;
  confidence: number;
  reasoning: string;
}

interface NativeScoreRunOutput {
  results: NativeScoreOutput[];
  manifest_json: string;
  manifest_path: string;
  score_update_events: number;
  prompt_template_version: string;
  provider_request_owner: string;
}

export interface NativeScoreRunReceipt {
  mode: 'tauri-rust-core' | 'desktop-preview-fallback';
  results: ScoreResult[];
  manifestJson: string;
  manifestPath: string;
  scoreUpdateEvents: number;
  promptTemplateVersion: string;
  providerRequestOwner: string;
}

export async function runNativeScoreRun(
  surface: SurfaceMode,
  project: RubricProject,
  samples: RubricSample[],
): Promise<NativeScoreRunReceipt | null> {
  if (surface !== 'desktop') {
    return null;
  }

  const enabledJudgeIds = project.judges.filter((judge) => judge.enabled).map((judge) => judge.id);
  const invoke = await loadTauriInvoke();
  if (invoke && typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
    const output = await invoke<NativeScoreRunOutput>('prepare_score_run', {
      projectId: project.id,
      criteria: project.criteria.map(toNativeCriterion),
      samples: samples.map(toNativeSample),
      judgeIds: enabledJudgeIds,
    });
    return nativeOutputToReceipt(output);
  }

  return fallbackScoreRun(project, samples, enabledJudgeIds);
}

function fallbackScoreRun(
  project: RubricProject,
  samples: RubricSample[],
  enabledJudgeIds: string[],
): NativeScoreRunReceipt {
  const judges = project.judges.filter((judge) => enabledJudgeIds.includes(judge.id));
  const results = scoreSamples(project, samples, judges);
  const runId = stableRunId(project.id, results.length);
  const manifestPath = `.rubric/score-runs/${runId}-eval-run-manifest.json`;
  const manifestJson = JSON.stringify({
    schema: 'eval-run-manifest.v1',
    project_id: project.id,
    run_id: runId,
    scorer: 'rubric-studio-open-rust-core-preview',
    prompt_template_version: 'rubric-studio-open/v1',
    provider_request_owner: 'tauri-rust-core',
    result_count: results.length,
    score_update_events: results.length,
    manifest_path: manifestPath,
    sends_api_keys_to_auraone: false,
  });

  return {
    mode: 'desktop-preview-fallback',
    results,
    manifestJson,
    manifestPath,
    scoreUpdateEvents: results.length,
    promptTemplateVersion: 'rubric-studio-open/v1',
    providerRequestOwner: 'tauri-rust-core',
  };
}

function nativeOutputToReceipt(output: NativeScoreRunOutput): NativeScoreRunReceipt {
  return {
    mode: 'tauri-rust-core',
    results: output.results.map((result) => ({
      criterionId: result.criterion_id,
      sampleId: result.sample_id,
      judgeId: result.judge_id,
      verdict: result.verdict,
      score: result.score,
      confidence: result.confidence,
      reasoning: result.reasoning,
    })),
    manifestJson: output.manifest_json,
    manifestPath: output.manifest_path,
    scoreUpdateEvents: output.score_update_events,
    promptTemplateVersion: output.prompt_template_version,
    providerRequestOwner: output.provider_request_owner,
  };
}

function toNativeCriterion(criterion: Criterion) {
  return {
    id: criterion.id,
    label: criterion.label,
    description: criterion.description,
    weight: criterion.weight,
    positive_examples: criterion.positiveExamples,
    negative_examples: criterion.negativeExamples,
  };
}

function toNativeSample(sample: RubricSample) {
  return {
    id: sample.id,
    prompt: sample.prompt,
    response: sample.response,
  };
}

function stableRunId(projectId: string, resultCount: number): string {
  let hash = 0;
  const value = `${projectId}:${resultCount}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
}

async function loadTauriInvoke(): Promise<Invoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as Invoke;
  } catch {
    return null;
  }
}

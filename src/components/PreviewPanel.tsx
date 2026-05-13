import { useState } from 'react';
import { distributionForCriterion, scoreSamples } from '../domain/engine';
import { streamOllamaCriterionScore } from '../domain/ollama';
import type { ScoreResult, RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { SampleControls } from './SampleControls';

export function PreviewPanel(props: {
  project: RubricProject;
  selectedSampleId: string;
  selectedSample: RubricProject['samples'][number];
  results: ReturnType<typeof scoreSamples>;
  running: boolean;
  surface: SurfaceMode;
  onRun: () => void;
  onSelectSample: (sampleId: string) => void;
  onAddSample: (sample: RubricSample) => void;
}) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [disagreementsOnly, setDisagreementsOnly] = useState(false);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);
  const [ollamaRunningId, setOllamaRunningId] = useState<string | null>(null);
  const [ollamaTraces, setOllamaTraces] = useState<Record<string, string>>({});
  const [ollamaScores, setOllamaScores] = useState<Record<string, ScoreResult>>({});
  const [ollamaError, setOllamaError] = useState('');
  const activeResults = props.results.filter((result) => result.sampleId === props.selectedSampleId);
  const disagreementIds = new Set(
    props.project.criteria
      .filter((criterion) => {
        const verdicts = new Set(
          activeResults
            .filter((result) => result.criterionId === criterion.id)
            .map((result) => result.verdict),
        );
        return verdicts.size > 1;
      })
      .map((criterion) => criterion.id),
  );
  const visibleResults = activeResults.filter((result) => {
    if (failuresOnly && result.verdict === 'pass') return false;
    if (disagreementsOnly && !disagreementIds.has(result.criterionId)) return false;
    if (lowConfidenceOnly && result.confidence >= 0.72) return false;
    return true;
  });
  const resultsWithLiveOllama = visibleResults.map((result) => {
    const key = `${result.sampleId}:${result.criterionId}:${result.judgeId}`;
    return ollamaScores[key] ?? result;
  });

  async function runOllamaTrace(result: ScoreResult) {
    const criterion = props.project.criteria.find((item) => item.id === result.criterionId);
    const judge = props.project.judges.find((item) => item.id === result.judgeId);
    if (!criterion || !judge || judge.provider !== 'ollama') {
      return;
    }
    const key = `${result.sampleId}:${result.criterionId}:${result.judgeId}`;
    setOllamaError('');
    setOllamaRunningId(key);
    setOllamaTraces((current) => ({ ...current, [key]: '' }));
    try {
      const score = await streamOllamaCriterionScore({
        model: judge.model,
        criterion,
        sample: props.selectedSample,
        onToken: (token) => setOllamaTraces((current) => ({ ...current, [key]: `${current[key] ?? ''}${token}` })),
      });
      setOllamaScores((current) => ({ ...current, [key]: { ...score, judgeId: judge.id } }));
    } catch (error) {
      setOllamaError(error instanceof Error ? error.message : 'Ollama stream failed.');
    } finally {
      setOllamaRunningId(null);
    }
  }

  return (
    <div className="panel-grid preview-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div>
            <p>Preview</p>
            <h2>Live testing</h2>
          </div>
          <div className="inline-actions">
            <button className="glass-button" type="button" onClick={props.onRun}>Score current</button>
            <button className="glass-button primary" type="button" onClick={props.onRun}>Score all</button>
          </div>
        </div>
        <SampleControls
          project={props.project}
          selectedSampleId={props.selectedSampleId}
          surface={props.surface}
          onSelect={props.onSelectSample}
          onAddSample={props.onAddSample}
        />
        <div className="toggle-row filter-row" aria-label="Score result filters">
          <label><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures</label>
          <label><input type="checkbox" checked={disagreementsOnly} onChange={(event) => setDisagreementsOnly(event.target.checked)} />Disagreements</label>
          <label><input type="checkbox" checked={lowConfidenceOnly} onChange={(event) => setLowConfidenceOnly(event.target.checked)} />Low confidence</label>
        </div>
        {props.running ? <LoadingState label="Scoring all criteria with cancellable progress" /> : null}
        <article className="sample-card">
          <p>{props.selectedSample.id} · {props.project.samples.length} samples loaded</p>
          <small>{props.selectedSample.prompt}</small>
          <blockquote>{props.selectedSample.response}</blockquote>
        </article>
        <div className="judge-grid">
          {props.project.judges.filter((judge) => judge.enabled).map((judge) => (
            <div key={judge.id} className="judge-column">
              <h3>{judge.label}</h3>
              {judge.provider === 'ollama' && props.surface === 'browser' ? (
                <div className="callout"><strong>Desktop only</strong><p>Browser edition cannot reach local model judges. Open the desktop app for Ollama streaming.</p></div>
              ) : null}
              {judge.provider === 'ollama' && ollamaError ? <span className="inline-error" role="alert">{ollamaError}</span> : null}
              {resultsWithLiveOllama
                .filter((result) => result.judgeId === judge.id)
                .map((result) => (
                  <details key={`${result.judgeId}-${result.criterionId}`} className={`score-card ${result.verdict}`}>
                    <summary>
                      <span>{props.project.criteria.find((criterion) => criterion.id === result.criterionId)?.label}</span>
                      <strong>{result.verdict}</strong>
                      <small>{result.confidence}</small>
                    </summary>
                    <p>{result.reasoning}</p>
                    {judge.provider === 'ollama' ? (
                      <div className="ollama-trace">
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={props.surface === 'browser' || ollamaRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}`}
                          onClick={() => runOllamaTrace(result)}
                        >
                          {ollamaRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}` ? 'Streaming...' : 'Stream Ollama trace'}
                        </button>
                        {ollamaTraces[`${result.sampleId}:${result.criterionId}:${result.judgeId}`] ? (
                          <pre>{ollamaTraces[`${result.sampleId}:${result.criterionId}:${result.judgeId}`]}</pre>
                        ) : null}
                      </div>
                    ) : null}
                  </details>
                ))}
              {resultsWithLiveOllama.filter((result) => result.judgeId === judge.id).length === 0 ? (
                <EmptyState title="No visible scores" body="Adjust filters or score a different sample." />
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <aside className="glass-panel">
        <div className="panel-title">
          <div>
            <p>Analysis</p>
            <h2>What did this catch?</h2>
          </div>
        </div>
        {props.project.criteria.map((criterion) => {
          const distribution = distributionForCriterion(props.results, criterion.id);
          return (
            <div className="distribution" key={criterion.id}>
              <button type="button">{criterion.label}</button>
              <div className="bars" aria-label={`Distribution for ${criterion.label}`}>
                <span style={{ width: `${distribution.pass * 18 + 8}%` }} className="pass" />
                <span style={{ width: `${distribution.partial * 18 + 8}%` }} className="partial" />
                <span style={{ width: `${distribution.fail * 18 + 8}%` }} className="fail" />
              </div>
              <small>
                {distribution.pass} pass · {distribution.partial} partial · {distribution.fail} fail
              </small>
            </div>
          );
        })}
        <div className="callout">
          <strong>{props.surface === 'browser' ? 'Browser scoring' : 'Desktop scoring'}</strong>
          <p>
            {props.surface === 'browser'
              ? 'Provider calls use BYO keys directly from the browser; Python sidecars remain disabled.'
              : 'Desktop can run local mock, Ollama, provider judges, and Python sidecars through the Rust core.'}
          </p>
        </div>
      </aside>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><span /><div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div><button className="ghost-button" type="button">Cancel</button></div>;
}

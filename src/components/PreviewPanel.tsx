import { useState } from 'react';
import { catchViewRows, type CatchSort, type CatchVerdictFilter } from '../domain/catchView';
import { distributionForCriterion, scoreSamples } from '../domain/engine';
import { readBrowserProviderSecret } from '../domain/keychain';
import { streamOllamaCriterionScore } from '../domain/ollama';
import { isRemoteJudge, scoreProviderCriterion } from '../domain/providerJudge';
import type { NativeScoreRunReceipt } from '../domain/nativeScoring';
import type { ScoreResult, RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { previewScaleWalls } from '../domain/scaleWalls';
import { SampleControls, type SampleActionRequest } from './SampleControls';
import { ScaleWallCallout } from './ScaleWallCallout';

export function PreviewPanel(props: {
  project: RubricProject;
  selectedSampleId: string;
  selectedSample: RubricProject['samples'][number];
  results: ReturnType<typeof scoreSamples>;
  nativeScoreRun: NativeScoreRunReceipt | null;
  running: boolean;
  runningScope: 'current' | 'all';
  surface: SurfaceMode;
  noNetworkMode: boolean;
  sampleActionRequest: SampleActionRequest | null;
  onRun: (scope: 'current' | 'all') => void;
  onCancelRun: () => void;
  onOpenSettings: () => void;
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
  const [providerRunningId, setProviderRunningId] = useState<string | null>(null);
  const [providerScores, setProviderScores] = useState<Record<string, ScoreResult>>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [providerRecovery, setProviderRecovery] = useState<Record<string, ScoreResult>>({});
  const [catchCriterionId, setCatchCriterionId] = useState(props.project.criteria[0]?.id ?? '');
  const [catchSort, setCatchSort] = useState<CatchSort>('confidence');
  const [catchVerdict, setCatchVerdict] = useState<CatchVerdictFilter>('all');
  const [comparisonCriterionId, setComparisonCriterionId] = useState<string | null>(null);
  const scaleWalls = previewScaleWalls(props.project);
  const activeResults = props.results.filter((result) => result.sampleId === props.selectedSampleId);
  const activeResultsWithLiveScores = activeResults.map((result) => {
    const key = `${result.sampleId}:${result.criterionId}:${result.judgeId}`;
    return providerScores[key] ?? ollamaScores[key] ?? result;
  });
  const disagreementIds = new Set(
    props.project.criteria
      .filter((criterion) => {
        const verdicts = new Set(
          activeResultsWithLiveScores
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
  const resultsWithLiveScores = visibleResults.map((result) => activeResultsWithLiveScores.find(
    (liveResult) =>
      liveResult.sampleId === result.sampleId &&
      liveResult.criterionId === result.criterionId &&
      liveResult.judgeId === result.judgeId,
  ) ?? result);
  const comparisonCriterion = props.project.criteria.find((criterion) => criterion.id === comparisonCriterionId);
  const comparisonRows = comparisonCriterion
    ? props.project.judges
      .filter((judge) => judge.enabled)
      .map((judge) => ({
        judge,
        result: activeResultsWithLiveScores.find(
          (result) => result.criterionId === comparisonCriterion.id && result.judgeId === judge.id,
        ),
      }))
      .filter((row): row is { judge: RubricProject['judges'][number]; result: ScoreResult } => Boolean(row.result))
    : [];
  const catchRows = catchViewRows(props.project, props.results, catchCriterionId, catchSort, catchVerdict);
  const themeDistributions = props.project.themes.map((theme) => {
    const criteria = props.project.criteria.filter((criterion) => criterion.themeId === theme.id);
    const totals = criteria.reduce(
      (sum, criterion) => {
        const distribution = distributionForCriterion(props.results, criterion.id);
        sum.pass += distribution.pass;
        sum.partial += distribution.partial;
        sum.fail += distribution.fail;
        sum.weight += criterion.weight;
        return sum;
      },
      { pass: 0, partial: 0, fail: 0, weight: 0 },
    );
    return { theme, totals };
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

  async function runProviderScore(result: ScoreResult) {
    const criterion = props.project.criteria.find((item) => item.id === result.criterionId);
    const judge = props.project.judges.find((item) => item.id === result.judgeId);
    if (!criterion || !judge || !isRemoteJudge(judge)) {
      return;
    }
    if (props.noNetworkMode) {
      setProviderErrors((current) => ({
        ...current,
        [judge.id]: 'No-network mode is active. Disable it in Settings before direct provider scoring.',
      }));
      setProviderRecovery((current) => ({ ...current, [judge.id]: result }));
      return;
    }
    const key = `${result.sampleId}:${result.criterionId}:${result.judgeId}`;
    const apiKey = readBrowserProviderSecret(judge);
    if (!apiKey) {
      setProviderErrors((current) => ({ ...current, [judge.id]: 'Configure this BYO provider key in Settings first.' }));
      setProviderRecovery((current) => ({ ...current, [judge.id]: result }));
      return;
    }
    setProviderRunningId(key);
    setProviderErrors((current) => ({ ...current, [judge.id]: '' }));
    setProviderRecovery((current) => {
      const next = { ...current };
      delete next[judge.id];
      return next;
    });
    try {
      const score = await scoreProviderCriterion({
        judge,
        criterion,
        sample: props.selectedSample,
        apiKey,
      });
      setProviderScores((current) => ({ ...current, [key]: score }));
    } catch (error) {
      setProviderErrors((current) => ({
        ...current,
        [judge.id]: error instanceof Error ? error.message : 'Direct provider scoring failed.',
      }));
      setProviderRecovery((current) => ({ ...current, [judge.id]: result }));
    } finally {
      setProviderRunningId(null);
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
            <button className="glass-button" type="button" onClick={() => props.onRun('current')}>Score current</button>
            <button className="glass-button primary" type="button" onClick={() => props.onRun('all')}>Score all</button>
          </div>
        </div>
        <SampleControls
          project={props.project}
          selectedSampleId={props.selectedSampleId}
          surface={props.surface}
          actionRequest={props.sampleActionRequest}
          onSelect={props.onSelectSample}
          onAddSample={props.onAddSample}
        />
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        <div className="toggle-row filter-row" aria-label="Score result filters">
          <label><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures</label>
          <label><input type="checkbox" checked={disagreementsOnly} onChange={(event) => setDisagreementsOnly(event.target.checked)} />Disagreements</label>
          <label><input type="checkbox" checked={lowConfidenceOnly} onChange={(event) => setLowConfidenceOnly(event.target.checked)} />Low confidence</label>
        </div>
        {props.running ? (
          <LoadingState
            label={props.runningScope === 'current' ? 'Scoring current sample with cancellable progress' : 'Scoring all samples with cancellable progress'}
            onCancel={props.onCancelRun}
          />
        ) : null}
        {props.nativeScoreRun ? <NativeScoreRunReceiptView receipt={props.nativeScoreRun} /> : null}
        <article className="sample-card">
          <p>{props.selectedSample.id} · {props.project.samples.length} samples loaded</p>
          {props.selectedSample.metadata.source ? (
            <small className="sample-provenance">
              {String(props.selectedSample.metadata.source)}
              {props.selectedSample.metadata.meta_prompt ? ` · ${String(props.selectedSample.metadata.meta_prompt)}` : ''}
            </small>
          ) : null}
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
              {props.surface === 'browser' && isRemoteJudge(judge) ? (
                <div className="callout"><strong>Direct BYO scoring</strong><p>{judge.provider} calls run from this browser with your session key and are never proxied through AuraOne.</p></div>
              ) : null}
              {props.noNetworkMode && isRemoteJudge(judge) ? (
                <div className="callout"><strong>No-network mode</strong><p>Direct provider scoring is disabled; local mock scores, authoring, validation, diff, and local exports stay available.</p></div>
              ) : null}
              {judge.provider === 'ollama' && ollamaError ? <span className="inline-error" role="alert">{ollamaError}</span> : null}
              {providerErrors[judge.id] ? (
                <span className="inline-error provider-error" role="alert">
                  {providerErrors[judge.id]}
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!providerRecovery[judge.id]}
                    onClick={() => void runProviderScore(providerRecovery[judge.id])}
                  >
                    Retry direct provider scoring
                  </button>
                  <button className="ghost-button" type="button" onClick={props.onOpenSettings}>
                    Rotate key in Settings
                  </button>
                </span>
              ) : null}
              {resultsWithLiveScores
                .filter((result) => result.judgeId === judge.id)
                .map((result) => (
                  <details key={`${result.judgeId}-${result.criterionId}`} className={`score-card ${result.verdict}`}>
                    <summary>
                      <span>{props.project.criteria.find((criterion) => criterion.id === result.criterionId)?.label}</span>
                      <strong>{result.verdict}</strong>
                      <small>{result.confidence}</small>
                    </summary>
                    <p>{result.reasoning}</p>
                    {disagreementIds.has(result.criterionId) ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setComparisonCriterionId(result.criterionId)}
                      >
                        Compare disagreement
                      </button>
                    ) : null}
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
                    {props.surface === 'browser' && isRemoteJudge(judge) ? (
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!judge.keyConfigured || props.noNetworkMode || providerRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}`}
                        onClick={() => runProviderScore(result)}
                      >
                        {providerRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}` ? 'Scoring...' : 'Run direct provider score'}
                      </button>
                    ) : null}
                  </details>
                ))}
              {resultsWithLiveScores.filter((result) => result.judgeId === judge.id).length === 0 ? (
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
        {comparisonCriterion ? (
          <section className="comparison-panel" aria-label="Side-by-side judge comparison">
            <div className="comparison-title">
              <div>
                <p>Side-by-side judge comparison</p>
                <h3>{comparisonCriterion.label}</h3>
              </div>
              <button className="ghost-button" type="button" onClick={() => setComparisonCriterionId(null)}>
                Clear
              </button>
            </div>
            <div className="comparison-grid">
              {comparisonRows.map(({ judge, result }) => (
                <article key={judge.id} className={`comparison-card ${result.verdict}`}>
                  <strong>{judge.label}</strong>
                  <dl>
                    <div><dt>Verdict</dt><dd>{result.verdict}</dd></div>
                    <div><dt>Score</dt><dd>{result.score.toFixed(2)}</dd></div>
                    <div><dt>Confidence</dt><dd>{Math.round(result.confidence * 100)}%</dd></div>
                  </dl>
                  <p>{result.reasoning}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        <div className="catch-controls">
          <label>
            Criterion
            <select value={catchCriterionId} onChange={(event) => setCatchCriterionId(event.target.value)}>
              {props.project.criteria.map((criterion) => <option key={criterion.id} value={criterion.id}>{criterion.label}</option>)}
            </select>
          </label>
          <label>
            Sort
            <select value={catchSort} onChange={(event) => setCatchSort(event.target.value as CatchSort)}>
              <option value="confidence">low confidence</option>
              <option value="agreement">judge disagreement</option>
              <option value="score-delta">score delta</option>
            </select>
          </label>
          <label>
            Verdict
            <select value={catchVerdict} onChange={(event) => setCatchVerdict(event.target.value as CatchVerdictFilter)}>
              <option value="all">all verdicts</option>
              <option value="pass">pass</option>
              <option value="partial">partial</option>
              <option value="fail">fail</option>
            </select>
          </label>
        </div>
        <div className="catch-table" aria-label="Caught samples">
          {catchRows.slice(0, 5).map((row) => (
            <details key={row.sampleId} className={`catch-row ${row.verdict}`}>
              <summary title={row.reasoning}>
                <strong>{row.sampleId}</strong>
                <span>{row.verdict}</span>
                <small>{Math.round(row.confidence * 100)}% confidence</small>
              </summary>
              <p>Agreement {Math.round(row.agreement * 100)}% · score delta {row.scoreDelta.toFixed(2)}</p>
              <pre>{row.reasoning}</pre>
            </details>
          ))}
        </div>
        {props.project.criteria.map((criterion) => {
          const distribution = distributionForCriterion(props.results, criterion.id);
          return (
            <div className="distribution" key={criterion.id}>
              <div className="distribution-heading">
                <button type="button" onClick={() => setCatchCriterionId(criterion.id)}>{criterion.label}</button>
                {disagreementIds.has(criterion.id) ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setComparisonCriterionId(criterion.id)}
                  >
                    Compare
                  </button>
                ) : null}
              </div>
              <div className="bars" role="group" aria-label={`Distribution for ${criterion.label}`}>
                <button type="button" aria-label={`${criterion.label} pass samples`} style={{ width: `${distribution.pass * 18 + 8}%` }} className="pass" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('pass'); }} />
                <button type="button" aria-label={`${criterion.label} partial samples`} style={{ width: `${distribution.partial * 18 + 8}%` }} className="partial" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('partial'); }} />
                <button type="button" aria-label={`${criterion.label} fail samples`} style={{ width: `${distribution.fail * 18 + 8}%` }} className="fail" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('fail'); }} />
              </div>
              <small>
                {distribution.pass} pass · {distribution.partial} partial · {distribution.fail} fail
              </small>
            </div>
          );
        })}
        <div className="theme-distribution" aria-label="Theme stacked bars">
          {themeDistributions.map(({ theme, totals }) => (
            <div key={theme.id} className="distribution theme-row">
              <strong>{theme.label}</strong>
              <div className="bars" role="img" aria-label={`${theme.label} theme contribution`}>
                <span style={{ width: `${totals.pass * 10 + 8}%` }} className="pass" />
                <span style={{ width: `${totals.partial * 10 + 8}%` }} className="partial" />
                <span style={{ width: `${totals.fail * 10 + 8}%` }} className="fail" />
              </div>
              <small>weight {totals.weight.toFixed(2)} · {totals.pass + totals.partial + totals.fail} scored cells</small>
            </div>
          ))}
        </div>
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

function NativeScoreRunReceiptView({ receipt }: { receipt: NativeScoreRunReceipt }) {
  return (
    <div className="native-score-receipt" role="status" aria-live="polite">
      <strong>{receipt.mode === 'tauri-rust-core' ? 'Rust core score run' : 'Desktop score-run preview'}</strong>
      <p>
        {receipt.providerRequestOwner} prepared {receipt.results.length} results, emitted {receipt.scoreUpdateEvents} score-update events, and wrote the eval-run manifest plan.
      </p>
      <dl className="status-grid">
        <div><dt>Prompt template</dt><dd>{receipt.promptTemplateVersion}</dd></div>
        <div><dt>Manifest</dt><dd>{receipt.manifestPath}</dd></div>
        <div><dt>AuraOne keys</dt><dd>{receipt.manifestJson.includes('"sends_api_keys_to_auraone":false') ? 'not sent' : 'blocked'}</dd></div>
      </dl>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="skeleton-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div>
      <button className="ghost-button" type="button" onClick={onCancel}>Cancel score run</button>
    </div>
  );
}

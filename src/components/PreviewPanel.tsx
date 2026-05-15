import { useState } from 'react';
import { catchViewRows, type CatchSort, type CatchVerdictFilter } from '../domain/catchView';
import { distributionForCriterion, scoreSamples } from '../domain/engine';
import { readBrowserProviderSecret } from '../domain/keychain';
import { streamOllamaCriterionScore } from '../domain/ollama';
import { isRemoteJudge, scoreProviderCriterion } from '../domain/providerJudge';
import type { ScoreResult, RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { defaultGoldScores, parseJsonlSamples } from '../domain/samples';
import { previewScaleWalls } from '../domain/scaleWalls';
import { SampleControls } from './SampleControls';
import { ScaleWallCallout } from './ScaleWallCallout';

export function PreviewPanel(props: {
  project: RubricProject;
  selectedSampleId: string;
  selectedSample: RubricProject['samples'][number];
  results: ReturnType<typeof scoreSamples>;
  running: boolean;
  surface: SurfaceMode;
  noNetworkMode: boolean;
  onRun: () => void;
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
  const [sampleImportStatus, setSampleImportStatus] = useState('');
  const scaleWalls = previewScaleWalls(props.project);
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
  const resultsWithLiveScores = visibleResults.map((result) => {
    const key = `${result.sampleId}:${result.criterionId}:${result.judgeId}`;
    return providerScores[key] ?? ollamaScores[key] ?? result;
  });
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

  async function importJsonl(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const imported = parseJsonlSamples(await file.text(), props.project);
      if (imported.length === 0) {
        setSampleImportStatus('No samples were found in that JSONL file.');
        return;
      }
      imported.forEach(props.onAddSample);
      setSampleImportStatus(`Loaded ${imported.length} sample${imported.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch {
      setSampleImportStatus('Sample import failed. Use JSONL rows with id, prompt, and response fields.');
    }
  }

  function generateSyntheticSample() {
    const sample: RubricSample = {
      id: `synthetic-${Date.now()}`,
      prompt: 'Synthetic calibration prompt generated for rubric smoke testing.',
      response:
        'This response gives concrete steps, names uncertainty, cites missing evidence, and redirects unsafe requests toward a safe alternative.',
      metadata: {
        source: 'synthetic',
        topic: 'generated smoke test',
        previewScore: 86,
      },
      goldScores: defaultGoldScores(props.project),
    };
    props.onAddSample(sample);
    setSampleImportStatus(`Generated ${sample.id}.`);
  }

  return (
    <div className="rs-surface rs-preview-surface">
      <header className="rs-surface-header">
        <div className="rs-breadcrumb">
          <span>Live testing</span>
        </div>
        <div className="rs-header-actions">
          <label className="ghost-button file-button" aria-label="Load sample JSONL">
            Load JSONL
            <input
              type="file"
              accept=".jsonl,application/json"
              onChange={(event) => {
                void importJsonl(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button className="ghost-button" type="button" onClick={generateSyntheticSample}>Generate synthetic</button>
          <button className="glass-button" type="button" onClick={props.onRun}>Score current</button>
          <button className="glass-button primary" type="button" onClick={props.onRun}>Score all · {props.project.samples.length} samples</button>
        </div>
      </header>

      <div className="rs-preview-body">
        <section className="rs-preview-main">
          <div className="rs-eyebrow">Sample</div>
          <div className="rs-sample-deck">
            {props.project.samples.map((sample) => {
              const sampleResults = props.results.filter((result) => result.sampleId === sample.id);
              const average = typeof sample.metadata.previewScore === 'number'
                ? sample.metadata.previewScore
                : sampleResults.length
                ? Math.round((sampleResults.reduce((sum, result) => sum + result.score, 0) / sampleResults.length) * 100)
                : 0;
              return (
                <button
                  key={sample.id}
                  type="button"
                  className={sample.id === props.selectedSampleId ? 'active' : ''}
                  onClick={() => props.onSelectSample(sample.id)}
                >
                  <span>{sample.id}</span>
                  <b>{average}%</b>
                  <strong>{String(sample.metadata.topic ?? sample.id).replace(/-/g, ' ')}</strong>
                </button>
              );
            })}
          </div>

          <div className="rs-conversation">
            <article>
              <span>User</span>
              <p>{props.selectedSample.prompt}</p>
            </article>
            <article className="model">
              <span>Model</span>
              <p>{props.selectedSample.response}</p>
            </article>
          </div>

          <div className="rs-preview-filters">
            <span>Filter:</span>
            <label><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures</label>
            <label><input type="checkbox" checked={disagreementsOnly} onChange={(event) => setDisagreementsOnly(event.target.checked)} />Disagreements</label>
            <label><input type="checkbox" checked={lowConfidenceOnly} onChange={(event) => setLowConfidenceOnly(event.target.checked)} />Low confidence</label>
            <small>{props.surface === 'browser' ? 'Browser scoring uses BYO keys directly.' : 'Desktop scoring runs through the Rust core.'}</small>
          </div>

          {props.running ? <LoadingState label="Scoring all criteria with cancellable progress" onCancel={props.onCancelRun} /> : null}
          {sampleImportStatus ? <p className="success-chip" role="status">{sampleImportStatus}</p> : null}

          <div className="rs-eyebrow rs-judge-label">Judges · {props.project.judges.filter((judge) => judge.enabled).length} of {props.project.judges.length} enabled</div>
          <div className="rs-judge-grid">
            {props.project.judges.filter((judge) => judge.enabled).map((judge) => (
              <div key={judge.id} className="rs-judge-panel">
                <header>
                  <span className="tree-status live" />
                  <strong>{judge.label}</strong>
                  <code>{judge.provider}/{judge.model}</code>
                </header>
                {providerErrors[judge.id] ? (
                  <span className="inline-error provider-error" role="alert">
                    {providerErrors[judge.id]}
                    <button className="ghost-button" type="button" onClick={props.onOpenSettings}>
                      Rotate key in Settings
                    </button>
                  </span>
                ) : null}
                {resultsWithLiveScores
                  .filter((result) => result.judgeId === judge.id)
                  .map((result) => (
                    <div key={`${result.judgeId}-${result.criterionId}`} className={`rs-score-row ${result.verdict}`}>
                      <span>{props.project.criteria.find((criterion) => criterion.id === result.criterionId)?.label}</span>
                      <b>{result.verdict}</b>
                      <code>{result.confidence.toFixed(2)}</code>
                      {props.surface === 'browser' && isRemoteJudge(judge) ? (
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={!judge.keyConfigured || props.noNetworkMode || providerRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}`}
                          onClick={() => runProviderScore(result)}
                        >
                          {providerRunningId === `${result.sampleId}:${result.criterionId}:${result.judgeId}` ? 'Scoring...' : 'Run'}
                        </button>
                      ) : null}
                    </div>
                  ))}
                {resultsWithLiveScores.filter((result) => result.judgeId === judge.id).length === 0 ? (
                  <EmptyState title="No visible scores" body="Adjust filters or score a different sample." />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <aside className="rs-analysis-rail">
          <div className="rs-rail-block">
            <div className="rs-eyebrow">What did this catch?</div>
            <h2>Cites uncertainty lags.</h2>
            <p>Sort: low confidence · Verdict: all</p>
          </div>

          <div className="rs-rail-block rs-catch-list">
            {catchRows.slice(0, 3).map((row) => (
              <button key={row.sampleId} type="button" className={row.sampleId === props.selectedSampleId ? 'active' : ''} onClick={() => props.onSelectSample(row.sampleId)}>
                <strong>{row.sampleId}</strong>
                <span>{row.verdict}</span>
                <small>{Math.round(row.confidence * 100)}%</small>
              </button>
            ))}
          </div>

          <div className="rs-rail-block">
            <div className="rs-eyebrow">Verdict mix by criterion</div>
            {props.project.criteria.map((criterion) => {
              const distribution = distributionForCriterion(props.results, criterion.id);
              return (
                <div className="distribution" key={criterion.id}>
                  <button type="button" onClick={() => setCatchCriterionId(criterion.id)}>{criterion.label}</button>
                  <div className="bars" role="group" aria-label={`Distribution for ${criterion.label}`}>
                    <button type="button" aria-label={`${criterion.label} pass samples`} style={{ width: `${distribution.pass * 18 + 8}%` }} className="pass" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('pass'); }} />
                    <button type="button" aria-label={`${criterion.label} partial samples`} style={{ width: `${distribution.partial * 18 + 8}%` }} className="partial" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('partial'); }} />
                    <button type="button" aria-label={`${criterion.label} fail samples`} style={{ width: `${distribution.fail * 18 + 8}%` }} className="fail" onClick={() => { setCatchCriterionId(criterion.id); setCatchVerdict('fail'); }} />
                  </div>
                  <small>{distribution.pass} pass · {distribution.partial} partial · {distribution.fail} fail</small>
                </div>
              );
            })}
          </div>

          <div className="rs-rail-block">
            <div className="rs-eyebrow">Theme weight</div>
            {themeDistributions.map(({ theme, totals }) => (
              <div key={theme.id} className="distribution theme-row">
                <strong>{theme.label}</strong>
                <div className="bars" role="img" aria-label={`${theme.label} theme contribution`}>
                  <span style={{ width: `${totals.pass * 10 + 8}%` }} className="pass" />
                  <span style={{ width: `${totals.partial * 10 + 8}%` }} className="partial" />
                  <span style={{ width: `${totals.fail * 10 + 8}%` }} className="fail" />
                </div>
                <small>weight {totals.weight.toFixed(2)}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );

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
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        <div className="toggle-row filter-row" aria-label="Score result filters">
          <label><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures</label>
          <label><input type="checkbox" checked={disagreementsOnly} onChange={(event) => setDisagreementsOnly(event.target.checked)} />Disagreements</label>
          <label><input type="checkbox" checked={lowConfidenceOnly} onChange={(event) => setLowConfidenceOnly(event.target.checked)} />Low confidence</label>
        </div>
        {props.running ? <LoadingState label="Scoring all criteria with cancellable progress" onCancel={props.onCancelRun} /> : null}
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
              <button type="button" onClick={() => setCatchCriterionId(criterion.id)}>{criterion.label}</button>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span />
      <div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div>
      <button className="ghost-button" type="button" onClick={onCancel}>Cancel score run</button>
    </div>
  );
}

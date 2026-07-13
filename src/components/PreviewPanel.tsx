import { useState } from 'react';
import { catchViewRows, type CatchSort, type CatchVerdictFilter } from '../domain/catchView';
import { distributionForCriterion, scoreSamples } from '../domain/engine';
import { readBrowserProviderSecret } from '../domain/keychain';
import { streamOllamaCriterionScore } from '../domain/ollama';
import { isRemoteJudge, scoreProviderCriterion } from '../domain/providerJudge';
import type { Criterion, JudgeConfig, ScoreResult, RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { defaultGoldScores, parseJsonlSamples } from '../domain/samples';

export function PreviewPanel(props: {
  project: RubricProject;
  selectedSampleId: string;
  selectedSample: RubricSample | undefined;
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
  const [catchCriterionId, setCatchCriterionId] = useState(props.project.criteria[0]?.id ?? '');
  const [catchSort] = useState<CatchSort>('confidence');
  const [catchVerdict, setCatchVerdict] = useState<CatchVerdictFilter>('all');
  const [sampleImportStatus, setSampleImportStatus] = useState('');
  const [sampleImportError, setSampleImportError] = useState('');
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
  const localAverage = activeResults.length
    ? Math.round((activeResults.reduce((sum, result) => sum + result.score, 0) / activeResults.length) * 100)
    : 0;

  async function runOllamaTrace(judge: JudgeConfig, criterion: Criterion) {
    if (!props.selectedSample || judge.provider !== 'ollama') {
      return;
    }
    const key = scoreKey(props.selectedSample.id, criterion.id, judge.id);
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

  async function runProviderScore(judge: JudgeConfig, criterion: Criterion) {
    if (!props.selectedSample || !isRemoteJudge(judge)) {
      return;
    }
    if (props.surface !== 'browser') {
      setProviderErrors((current) => ({
        ...current,
        [judge.id]: 'Direct provider execution is available in the supported browser path. This desktop build does not expose provider secrets back to the renderer.',
      }));
      return;
    }
    if (props.noNetworkMode) {
      setProviderErrors((current) => ({
        ...current,
        [judge.id]: 'No-network mode is active. Disable it in Settings before direct provider scoring.',
      }));
      return;
    }
    const apiKey = readBrowserProviderSecret(judge);
    if (!apiKey) {
      setProviderErrors((current) => ({ ...current, [judge.id]: 'Configure this BYO provider key in Settings first.' }));
      return;
    }
    const key = scoreKey(props.selectedSample.id, criterion.id, judge.id);
    setProviderRunningId(key);
    setProviderErrors((current) => ({ ...current, [judge.id]: '' }));
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
        setSampleImportStatus('');
        setSampleImportError('No samples were found in that JSONL file.');
        return;
      }
      imported.forEach(props.onAddSample);
      setSampleImportStatus(`Loaded ${imported.length} sample${imported.length === 1 ? '' : 's'} from ${file.name}. Missing gold labels remain unlabeled.`);
      setSampleImportError('');
    } catch {
      setSampleImportStatus('');
      setSampleImportError('Sample import failed. Use JSONL rows with id, prompt, and response fields.');
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
        topic: 'Generated smoke test',
      },
      goldScores: defaultGoldScores(props.project),
    };
    props.onAddSample(sample);
    setSampleImportStatus(`Generated ${sample.id} with synthetic fixture labels.`);
    setSampleImportError('');
  }

  function resultFor(judge: JudgeConfig, criterion: Criterion): ScoreResult | undefined {
    if (!props.selectedSample) return undefined;
    const key = scoreKey(props.selectedSample.id, criterion.id, judge.id);
    return providerScores[key]
      ?? ollamaScores[key]
      ?? props.results.find(
        (result) =>
          result.sampleId === props.selectedSample?.id &&
          result.criterionId === criterion.id &&
          result.judgeId === judge.id,
      );
  }

  function resultPassesFilters(result: ScoreResult | undefined): boolean {
    if (!result) return !failuresOnly && !disagreementsOnly && !lowConfidenceOnly;
    if (failuresOnly && result.verdict === 'pass') return false;
    if (disagreementsOnly && !disagreementIds.has(result.criterionId)) return false;
    if (lowConfidenceOnly && result.confidence >= 0.72) return false;
    return true;
  }

  return (
    <div className="rs-surface rs-preview-surface">
      <header className="rs-surface-header">
        <div className="rs-view-identity">
          <div className="rs-breadcrumb"><span>Local testing</span></div>
          <span className="rs-view-state success">
            {props.project.samples.length} samples · local fixtures
          </span>
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
          <button className="ghost-button" type="button" onClick={generateSyntheticSample}>Generate fixture</button>
          <button className="solid-button primary" type="button" onClick={props.onRun}>Run local fixtures</button>
        </div>
      </header>

      <div className="rs-preview-body">
        <section className="rs-preview-main">
          <div className="rs-section-heading">
            <div><h2>Reviewer preview</h2><p>Inspect the response as a reviewer sees it, then distinguish local fixture evidence from real provider results.</p></div>
            <button className="solid-button" type="button" onClick={props.onRun}>Recompute selected</button>
          </div>
          {props.project.samples.length === 0 || !props.selectedSample ? (
            <EmptyState title="No samples loaded" body="Load a JSONL sample file or generate a synthetic fixture to begin local analysis." />
          ) : (
            <>
              <div className="rs-sample-deck" tabIndex={0} role="region" aria-label="Evaluation samples">
                {props.project.samples.map((sample) => {
                  const sampleResults = props.results.filter((result) => result.sampleId === sample.id);
                  const average = sampleResults.length
                    ? Math.round((sampleResults.reduce((sum, result) => sum + result.score, 0) / sampleResults.length) * 100)
                    : 0;
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      className={sample.id === props.selectedSampleId ? 'active' : ''}
                      onClick={() => props.onSelectSample(sample.id)}
                    >
                      <span>{String(sample.metadata.topic ?? sample.id).replace(/-/g, ' ')}</span>
                      <b>{average}%</b>
                      <strong>{sample.id}</strong>
                    </button>
                  );
                })}
              </div>

              <div className="rs-review-frame">
                <div className="rs-conversation">
                  <article>
                    <span>Prompt</span>
                    <p>{props.selectedSample.prompt}</p>
                  </article>
                  <article className="model">
                    <span>Response</span>
                    <p>{props.selectedSample.response}</p>
                  </article>
                </div>
                <aside className="rs-sample-summary" aria-label="Selected sample local fixture summary">
                  <span>Local fixture score</span>
                  <strong>{localAverage}<small>/100</small></strong>
                  <dl>
                    <div><dt>Pass</dt><dd>{activeResults.filter((result) => result.verdict === 'pass').length}</dd></div>
                    <div><dt>Partial</dt><dd>{activeResults.filter((result) => result.verdict === 'partial').length}</dd></div>
                    <div><dt>Fail</dt><dd>{activeResults.filter((result) => result.verdict === 'fail').length}</dd></div>
                  </dl>
                </aside>
              </div>
            </>
          )}

          <div className="rs-preview-filters" tabIndex={0} role="region" aria-label="Score filters">
            <span>Show</span>
            <label><input type="checkbox" checked={failuresOnly} onChange={(event) => setFailuresOnly(event.target.checked)} />Failures</label>
            <label><input type="checkbox" checked={disagreementsOnly} onChange={(event) => setDisagreementsOnly(event.target.checked)} />Disagreements</label>
            <label><input type="checkbox" checked={lowConfidenceOnly} onChange={(event) => setLowConfidenceOnly(event.target.checked)} />Low confidence</label>
            <small>{props.surface === 'browser' ? 'Remote results appear only after a direct BYO provider call.' : 'Remote providers remain not run; Ollama can execute locally when configured.'}</small>
          </div>

          {props.running ? <LoadingState label="Recomputing deterministic local fixture scores" onCancel={props.onCancelRun} /> : null}
          {sampleImportStatus ? <p className="success-chip" role="status">{sampleImportStatus}</p> : null}
          {sampleImportError ? <p className="inline-error" role="alert">{sampleImportError}</p> : null}
          {ollamaError ? <p className="inline-error" role="alert">{ollamaError}</p> : null}

          <div className="rs-section-heading compact rs-judge-label">
            <div><h3>Judge evidence</h3><p>Every row names whether it is a deterministic fixture, an actual provider result, or not run.</p></div>
          </div>
          <div className="rs-judge-grid">
            {props.project.judges.filter((judge) => judge.enabled).map((judge) => {
              const remoteJudge = isRemoteJudge(judge);
              const remoteProviderReady =
                remoteJudge &&
                props.surface === 'browser' &&
                Boolean(readBrowserProviderSecret(judge));
              const rows = props.project.criteria
                .map((criterion) => ({ criterion, result: resultFor(judge, criterion) }))
                .filter(({ result }) => resultPassesFilters(result));
              return (
                <div key={judge.id} className="rs-judge-panel">
                  <header>
                    <div><span className={judge.provider === 'mock' ? 'tree-status live' : 'tree-status draft'} aria-hidden="true" /><strong>{judge.label}</strong></div>
                    <code>{judge.provider}/{judge.model}</code>
                  </header>
                  <p className="rs-judge-contract">
                    {judge.provider === 'mock'
                      ? 'Deterministic local fixture analysis'
                      : judge.provider === 'ollama'
                        ? 'Runs only after an explicit local Ollama action'
                        : props.surface === 'browser'
                          ? 'Runs only after an explicit direct provider action'
                          : 'Direct provider execution is available only on the supported browser path'}
                  </p>
                  {providerErrors[judge.id] ? (
                    <span className="inline-error provider-error" role="alert">
                      {providerErrors[judge.id]}
                      <button className="ghost-button" type="button" onClick={props.onOpenSettings}>Open Settings</button>
                    </span>
                  ) : null}
                  {rows.map(({ criterion, result }) => {
                    const key = props.selectedSample ? scoreKey(props.selectedSample.id, criterion.id, judge.id) : '';
                    const running = providerRunningId === key || ollamaRunningId === key;
                    return result ? (
                      <div key={`${judge.id}-${criterion.id}`} className={`rs-score-row ${result.verdict}`}>
                        <div>
                          <strong>{criterion.label}</strong>
                          <small>{result.reasoning}</small>
                          {ollamaTraces[key] ? <code className="rs-live-trace">{ollamaTraces[key]}</code> : null}
                        </div>
                        <b><span aria-hidden="true" />{result.verdict}</b>
                        <code>{Math.round(result.confidence * 100)}%</code>
                        {judge.provider !== 'mock' ? (
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={
                              running ||
                              props.noNetworkMode ||
                              (remoteJudge && props.surface !== 'browser')
                            }
                            onClick={() => judge.provider === 'ollama'
                              ? void runOllamaTrace(judge, criterion)
                              : void runProviderScore(judge, criterion)}
                          >
                            {running ? 'Running...' : 'Run again'}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div key={`${judge.id}-${criterion.id}`} className="rs-score-row pending">
                        <div><strong>{criterion.label}</strong><small>No result has been produced for this judge.</small></div>
                        <b><span aria-hidden="true" />Not run</b>
                        <code>--</code>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={
                            running ||
                            judge.provider === 'mock' ||
                            props.noNetworkMode ||
                            (remoteJudge && props.surface !== 'browser')
                          }
                          onClick={() => {
                            if (remoteJudge && !remoteProviderReady) {
                              props.onOpenSettings();
                              return;
                            }
                            if (judge.provider === 'ollama') {
                              void runOllamaTrace(judge, criterion);
                              return;
                            }
                            void runProviderScore(judge, criterion);
                          }}
                        >
                          {running
                            ? 'Running...'
                            : judge.provider === 'ollama'
                              ? 'Run local'
                              : props.surface !== 'browser'
                                ? 'Browser only'
                                : remoteProviderReady
                                  ? 'Run provider'
                                  : 'Configure'}
                        </button>
                      </div>
                    );
                  })}
                  {rows.length === 0 ? <EmptyState title="No visible rows" body="Adjust the score filters to show evidence." /> : null}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="rs-analysis-rail">
          <div className="rs-inspector-header">
            <div><strong>Review findings</strong><span>Deterministic local fixture</span></div>
          </div>
          <div className="rs-rail-block rs-finding-summary">
            <span className="rs-view-state warning">Fixture review</span>
            <h2>Cites uncertainty is the weakest local signal.</h2>
            <p>This finding comes from the deterministic local mock only. Provider rows do not contribute until they are actually run.</p>
          </div>

          <div className="rs-rail-block rs-catch-list">
            <div className="rs-inspector-title"><span>Lowest confidence</span><strong>{catchRows.length}</strong></div>
            {catchRows.slice(0, 3).map((row) => (
              <button key={row.sampleId} type="button" className={row.sampleId === props.selectedSampleId ? 'active' : ''} onClick={() => props.onSelectSample(row.sampleId)}>
                <strong>{row.sampleId}</strong>
                <span className={`rs-status status-${row.verdict}`}>{row.verdict}</span>
                <small>{Math.round(row.confidence * 100)}% confidence</small>
              </button>
            ))}
          </div>

          <div className="rs-rail-block">
            <div className="rs-inspector-title"><span>Verdict distribution</span></div>
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
            <div className="rs-inspector-title"><span>Theme contribution</span></div>
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
}

function scoreKey(sampleId: string, criterionId: string, judgeId: string): string {
  return `${sampleId}:${criterionId}:${judgeId}`;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function LoadingState({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span />
      <div><strong>{label}</strong><progress value={66} max={100}>66%</progress></div>
      <button className="ghost-button" type="button" onClick={onCancel}>Cancel local run</button>
    </div>
  );
}

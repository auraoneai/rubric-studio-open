import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCriterionRewriteSuggestions,
  calculateAdvancedCalibration,
  type CriterionRewriteSuggestion,
} from '../domain/advancedCalibration';
import { calculateCalibration, runBiasProbes, runContaminationAudit } from '../domain/engine';
import type { RubricProject, RubricSample, SurfaceMode } from '../domain/rubric';
import { parseGoldSetJsonl, type GoldSetImportSummary } from '../domain/samples';
import { calibrationScaleWalls } from '../domain/scaleWalls';
import { ScaleWallCallout } from './ScaleWallCallout';

type CalibrationItems = ReturnType<typeof calculateCalibration>;
export type CalibrationOperation = 'calibration' | 'bias' | 'contamination';

export function CalibrationPanel({
  project,
  calibration,
  surface,
  operationRequest,
  onStageCriterionRewrite,
  onLoadGoldSamples,
}: {
  project: RubricProject;
  calibration: CalibrationItems;
  surface: SurfaceMode;
  operationRequest: { operation: CalibrationOperation; nonce: number } | null;
  onStageCriterionRewrite: (suggestion: CriterionRewriteSuggestion) => void;
  onLoadGoldSamples: (samples: RubricSample[]) => void;
}) {
  const [history, setHistory] = useState<Array<{ id: string; meanKappa: number; coverage: number; rows: number }>>([]);
  const [rewriteDraft, setRewriteDraft] = useState<CriterionRewriteSuggestion | null>(null);
  const [goldSetSummary, setGoldSetSummary] = useState<GoldSetImportSummary | null>(null);
  const [goldSetError, setGoldSetError] = useState('');
  const [runningOperation, setRunningOperation] = useState<CalibrationOperation | null>(null);
  const [runStatus, setRunStatus] = useState('Sidecars ready for iaa-kit, judge-bench, and contamination-audit.');
  const operationTimerRef = useRef<number | null>(null);
  const probes = useMemo(() => runBiasProbes(project), [project]);
  const contamination = useMemo(() => runContaminationAudit(project), [project]);
  const advanced = useMemo(() => calculateAdvancedCalibration(project, calibration), [project, calibration]);
  const sorted = calibration.slice().sort((a, b) => a.kappa - b.kappa);
  const scaleWalls = calibrationScaleWalls(project);

  useEffect(() => {
    if (!operationRequest || surface === 'browser') {
      return;
    }
    return runCalibrationOperation(operationRequest.operation);
  }, [operationRequest?.nonce, surface]);

  useEffect(() => () => clearOperationTimer(), []);

  if (surface === 'browser') {
    return (
      <section className="glass-panel centered">
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        <DisabledFeature title="Calibration requires desktop" body="iaa-kit, judge-bench, and contamination-audit run as local Python sidecars and are intentionally unavailable in the browser edition." />
      </section>
    );
  }

  function recordRun(rows = project.samples.length) {
    const meanKappa =
      calibration.reduce((sum, item) => sum + item.kappa, 0) / Math.max(1, calibration.length);
    const coverage = calibration.reduce((sum, item) => sum + item.coverage, 0);
    setHistory((current) => [
      { id: `run-${current.length + 1}`, meanKappa: Number(meanKappa.toFixed(2)), coverage, rows },
      ...current,
    ]);
  }

  function runCalibrationOperation(operation: CalibrationOperation) {
    clearOperationTimer();
    setRunningOperation(operation);
    setRunStatus(runningLabel(operation));
    operationTimerRef.current = window.setTimeout(() => {
      if (operation === 'calibration') {
        recordRun();
      }
      setRunningOperation(null);
      setRunStatus(completedLabel(operation, probes.length, contamination.length));
      operationTimerRef.current = null;
    }, 650);
    return () => clearOperationTimer();
  }

  function clearOperationTimer() {
    if (operationTimerRef.current === null) {
      return;
    }
    window.clearTimeout(operationTimerRef.current);
    operationTimerRef.current = null;
  }

  function cancelCalibrationOperation() {
    if (!runningOperation) {
      return;
    }
    const canceledOperation = runningOperation;
    clearOperationTimer();
    setRunningOperation(null);
    setRunStatus(canceledLabel(canceledOperation));
  }

  async function importGoldSet(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const imported = parseGoldSetJsonl(await file.text(), project);
      if (imported.samples.length === 0) {
        setGoldSetError('Gold set JSONL did not contain any rows.');
        return;
      }
      setGoldSetSummary(imported.summary);
      setGoldSetError('');
      onLoadGoldSamples(imported.samples);
      recordRun(imported.samples.length);
    } catch (error) {
      setGoldSetError(error instanceof Error ? error.message : 'Gold set import failed.');
    }
  }

  function openRewritePanel(item = sorted[0]) {
    const suggestions = buildCriterionRewriteSuggestions(project, item);
    setRewriteDraft(suggestions[0] ?? null);
  }

  function stageRewrite() {
    if (!rewriteDraft) {
      return;
    }
    onStageCriterionRewrite(rewriteDraft);
    setRewriteDraft(null);
  }

  return (
    <div className="panel-grid calibration-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Calibration</p><h2>IAA metrics</h2></div>
          <div className="inline-actions">
            <button className="ghost-button" type="button" onClick={() => { runCalibrationOperation('calibration'); }}>
              Run calibration
            </button>
            <label className="file-button primary">
              <span>Load gold JSONL</span>
              <input
                aria-label="Load gold JSONL"
                type="file"
                accept=".jsonl,application/json"
                onChange={(event) => {
                  void importGoldSet(event.target.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <RunStatus operation={runningOperation} status={runStatus} onCancel={cancelCalibrationOperation} />
        {goldSetError ? <div className="inline-error" role="alert">{goldSetError}</div> : null}
        {goldSetSummary ? (
          <section className="gold-set-summary" aria-label="Gold set validation summary">
            <div>
              <strong>{goldSetSummary.completeRows}/{goldSetSummary.totalRows} complete rows</strong>
              <span>{goldSetSummary.missingScoreRows.length} rows with missing criterion scores</span>
            </div>
            {goldSetSummary.warnings.length > 0 ? (
              <ul>
                {goldSetSummary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : <p className="subtle">Gold set coverage is complete across every criterion.</p>}
            <table>
              <thead><tr><th>Criterion</th><th>Rows scored</th><th>Coverage</th></tr></thead>
              <tbody>
                {goldSetSummary.coverageByCriterion.slice(0, 6).map((row) => (
                  <tr key={row.criterionId}>
                    <td>{project.criteria.find((criterion) => criterion.id === row.criterionId)?.label ?? row.criterionId}</td>
                    <td>{row.scoredRows}</td>
                    <td>{Math.round(row.coverage * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        {calibration.map((item) => (
          <div key={item.criterionId} className="metric-row">
            <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
            <span>Cohen k {item.kappa}</span>
            <span>Weighted k {item.weightedKappa}</span>
            <span>Krippendorff alpha {item.krippendorffAlpha}</span>
            <span>CI {item.ci95[0]}..{item.ci95[1]}</span>
          </div>
        ))}
        <h3>Calibration history</h3>
        {history.length === 0 ? <EmptyState title="No calibration runs" body="Load a gold set to record a versioned calibration run." /> : null}
        {history.map((run) => (
          <div className="metric-row compact" key={run.id}>
            <strong>{run.id}</strong>
            <span>mean k {run.meanKappa}</span>
            <span>{run.coverage} scores</span>
            <span>{run.rows} rows</span>
          </div>
        ))}
        <section className="advanced-calibration" aria-label="Advanced calibration analysis">
          <div className="panel-title"><div><p>Advanced calibration</p><h3>Hierarchical IAA</h3></div><span className="success-chip">alpha {advanced.overallHierarchicalAlpha}</span></div>
          <div className="theme-calibration-grid">
            {advanced.themeSummaries.map((theme) => (
              <article key={theme.themeId} className={`theme-calibration-card ${theme.status}`}>
                <strong>{theme.label}</strong>
                <dl>
                  <div><dt>Criteria</dt><dd>{theme.criterionCount}</dd></div>
                  <div><dt>Mean k</dt><dd>{theme.meanKappa}</dd></div>
                  <div><dt>Weighted k</dt><dd>{theme.meanWeightedKappa}</dd></div>
                  <div><dt>Alpha</dt><dd>{theme.hierarchicalAlpha}</dd></div>
                </dl>
                <small>CI {theme.ci95[0]}..{theme.ci95[1]} · {theme.status}</small>
              </article>
            ))}
          </div>
          <h3>Latent class analysis</h3>
          <div className="latent-class-grid">
            {advanced.latentClasses.map((latentClass) => (
              <article key={latentClass.id} className="latent-class-card">
                <strong>{latentClass.label}</strong>
                <span>{Math.round(latentClass.probability * 100)}%</span>
                <p>{latentClass.recommendedAction}</p>
                <small>{latentClass.criterionIds.length} criteria</small>
              </article>
            ))}
          </div>
        </section>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Needs work</p><h2>Lowest agreement</h2></div><button className="glass-button" type="button" onClick={() => openRewritePanel()}>Suggest rewrite</button></div>
        {sorted.map((item) => (
          <div key={item.criterionId} className="rewrite-card">
            <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
            <p>Candidate rewrite: Make the evidence threshold observable and add an explicit boundary.</p>
            <small>Most disagreed samples: {item.mostDisagreedSampleIds.join(', ') || 'none'}</small>
            <button className="ghost-button" type="button" onClick={() => openRewritePanel(item)}>Open suggestions</button>
          </div>
        ))}
        {rewriteDraft ? (
          <div className="rewrite-panel">
            <strong>{rewriteDraft.title}</strong>
            <small>{rewriteDraft.reviewerNote}</small>
            <label>
              Proposed description
              <textarea
                value={rewriteDraft.proposedDescription}
                onChange={(event) => setRewriteDraft({ ...rewriteDraft, proposedDescription: event.target.value })}
              />
            </label>
            <label>
              Boundary guidance
              <textarea
                value={rewriteDraft.proposedBoundaries}
                onChange={(event) => setRewriteDraft({ ...rewriteDraft, proposedBoundaries: event.target.value })}
              />
            </label>
            <label>
              Positive example
              <input
                value={rewriteDraft.positiveExample}
                onChange={(event) => setRewriteDraft({ ...rewriteDraft, positiveExample: event.target.value })}
              />
            </label>
            <label>
              Negative example
              <input
                value={rewriteDraft.negativeExample}
                onChange={(event) => setRewriteDraft({ ...rewriteDraft, negativeExample: event.target.value })}
              />
            </label>
            <div className="inline-actions">
              <button className="ghost-button" type="button" onClick={() => setRewriteDraft(null)}>Reject</button>
              <button className="glass-button primary" type="button" onClick={stageRewrite}>Stage accepted rewrite</button>
            </div>
          </div>
        ) : null}
      </section>
      <aside className="glass-panel">
        <div className="panel-title"><div><p>Sidecars</p><h2>Bias and leakage</h2></div></div>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={() => { runCalibrationOperation('bias'); }}>
            Run bias probes
          </button>
          <button className="ghost-button" type="button" onClick={() => { runCalibrationOperation('contamination'); }}>
            Run contamination audit
          </button>
        </div>
        {probes.map((probe) => (
          <div key={probe.id} className={`probe ${probe.status}`}><strong>{probe.label}</strong><span>{probe.status}</span><p>{probe.reasoning}</p></div>
        ))}
        <h3>Contamination audit</h3>
        {contamination.map((row) => (
          <div key={row.sampleId} className="metric-row compact"><strong>{row.sampleId}</strong><span>{row.ngramOverlap} overlap</span><span>{row.exactMatch ? 'exact match' : 'no exact match'}</span></div>
        ))}
      </aside>
    </div>
  );
}

function runningLabel(operation: CalibrationOperation): string {
  if (operation === 'bias') {
    return 'Running judge-bench bias probes...';
  }
  if (operation === 'contamination') {
    return 'Running contamination-audit leakage check...';
  }
  return 'Running iaa-kit calibration...';
}

function completedLabel(operation: CalibrationOperation, probeCount: number, contaminationRows: number): string {
  if (operation === 'bias') {
    return `Bias probes completed across ${probeCount} probes.`;
  }
  if (operation === 'contamination') {
    return `Contamination audit completed across ${contaminationRows} samples.`;
  }
  return 'Calibration run recorded in history.';
}

function canceledLabel(operation: CalibrationOperation): string {
  if (operation === 'bias') {
    return 'Bias probe run canceled before sidecar results were applied.';
  }
  if (operation === 'contamination') {
    return 'Contamination audit canceled before leakage results were applied.';
  }
  return 'Calibration run canceled before history was updated.';
}

function progressLabel(operation: CalibrationOperation): string {
  if (operation === 'bias') {
    return 'Bias probe run progress';
  }
  if (operation === 'contamination') {
    return 'Contamination audit progress';
  }
  return 'Calibration run progress';
}

function RunStatus({
  operation,
  status,
  onCancel,
}: {
  operation: CalibrationOperation | null;
  status: string;
  onCancel: () => void;
}) {
  return (
    <div className="calibration-run-status" role="status" aria-live="polite">
      {operation ? (
        <span className="skeleton-pulse" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <div>
        <span>{status}</span>
        {operation ? <progress aria-label={progressLabel(operation)} value={66} max={100}>66%</progress> : null}
      </div>
      {operation ? <button className="ghost-button" type="button" onClick={onCancel}>Cancel calibration run</button> : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function DisabledFeature({ title, body }: { title: string; body: string }) {
  return <div><h2>{title}</h2><p>{body}</p><a className="glass-button primary" href="auraone://rubric-studio/open">Open desktop app</a></div>;
}

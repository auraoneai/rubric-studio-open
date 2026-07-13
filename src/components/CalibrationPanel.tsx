import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, WandSparkles } from 'lucide-react';
import { calculateCalibration, runBiasProbes, runContaminationAudit, scoreSamples } from '../domain/engine';
import type { RubricProject, RubricSample } from '../domain/rubric';
import { parseGoldJsonl } from '../domain/samples';

type CalibrationItems = ReturnType<typeof calculateCalibration>;

export function CalibrationPanel({
  project,
  calibration,
  onReplaceSamples,
}: {
  project: RubricProject;
  calibration: CalibrationItems;
  onReplaceSamples: (samples: RubricSample[]) => void;
}) {
  const [activeCalibration, setActiveCalibration] = useState(calibration);
  const [history, setHistory] = useState<Array<{ id: string; meanKappa: number; coverage: number }>>([]);
  const [rewriteCriterionId, setRewriteCriterionId] = useState<string | null>(null);
  const [goldStatus, setGoldStatus] = useState('');
  const [goldError, setGoldError] = useState('');
  const probes = useMemo(() => runBiasProbes(project), [project]);
  const contamination = useMemo(() => runContaminationAudit(project), [project]);
  const sorted = activeCalibration.slice().sort((a, b) => a.kappa - b.kappa);
  const meanKappa = activeCalibration.reduce((sum, item) => sum + item.kappa, 0) / Math.max(1, activeCalibration.length);
  const readyCount = activeCalibration.filter((item) => item.kappa >= 0.5).length;
  const totalCoverage = activeCalibration.reduce((sum, item) => sum + item.coverage, 0);
  const changedProbeVerdicts = probes.reduce((sum, probe) => sum + probe.changedVerdicts, 0);
  const comparedProbePairs = probes.reduce((sum, probe) => sum + probe.comparedPairs, 0);

  useEffect(() => {
    setActiveCalibration(calibration);
  }, [calibration]);

  function runCalibration() {
    const next = calculateCalibration(
      project,
      scoreSamples(project, project.samples, project.judges),
    );
    const nextMean = next.reduce((sum, item) => sum + item.kappa, 0) / Math.max(1, next.length);
    const coverage = next.reduce((sum, item) => sum + item.coverage, 0);
    setActiveCalibration(next);
    setHistory((current) => [
      { id: `run-${current.length + 1}`, meanKappa: Number(nextMean.toFixed(2)), coverage },
      ...current,
    ]);
    setGoldStatus(`Recomputed ${coverage} labeled decisions with the deterministic local fixture scorer.`);
    setGoldError('');
  }

  async function loadGoldSet(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const result = parseGoldJsonl(await file.text(), project);
      onReplaceSamples(result.samples);
      setGoldStatus(
        `Imported ${result.importedRows} gold row${result.importedRows === 1 ? '' : 's'} with ${result.labeledDecisions} labeled decisions from ${file.name}.`,
      );
      setGoldError('');
    } catch (error) {
      setGoldStatus('');
      setGoldError(error instanceof Error ? error.message : 'Gold JSONL import failed.');
    }
  }

  return (
    <div className="rs-surface rs-calibration-surface">
      <header className="rs-surface-header">
        <div className="rs-view-identity">
          <div className="rs-breadcrumb"><span>Calibration</span><b aria-hidden="true">/</b><code>current gold labels</code></div>
          <span className="rs-view-state">{totalCoverage} labeled decisions · deterministic local analysis</span>
        </div>
        <div className="rs-header-actions">
          <label className="ghost-button file-button" aria-label="Load gold JSONL">
            Load gold JSONL
            <input
              type="file"
              accept=".jsonl,application/json"
              onChange={(event) => {
                void loadGoldSet(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button className="ghost-button" type="button" onClick={() => setRewriteCriterionId(sorted[0]?.criterionId ?? null)}>
            <WandSparkles className="button-icon" aria-hidden="true" />
            Draft rewrite
          </button>
          <button className="solid-button primary" type="button" aria-label="Recompute calibration" onClick={runCalibration}>
            <RefreshCw className="button-icon" aria-hidden="true" />
            <span>Recompute</span>
          </button>
        </div>
      </header>
      <div className="rs-calibration-body">
        <section className="rs-calibration-main">
          <div className="rs-section-heading">
            <div><h2>Agreement overview</h2><p>Compare imported expert labels with the deterministic local fixture scorer and resolve weak criteria first.</p></div>
          </div>
          <div className="rs-metric-strip" aria-label="Calibration summary">
            <div><span>Mean agreement</span><strong>{meanKappa.toFixed(2)}</strong><small>Cohen kappa</small></div>
            <div><span>Ready criteria</span><strong>{readyCount}/{activeCalibration.length}</strong><small>kappa at least 0.50</small></div>
            <div><span>Gold coverage</span><strong>{totalCoverage}</strong><small>labeled decisions</small></div>
            <div className="attention"><span>Review queue</span><strong>{activeCalibration.length - readyCount}</strong><small>criteria below threshold</small></div>
          </div>
          {goldStatus ? <p className="success-chip" role="status">{goldStatus}</p> : null}
          {goldError ? <p className="inline-error" role="alert">{goldError}</p> : null}
          <div className="rs-section-heading compact rs-section-gap">
            <div><h3>Per-criterion agreement</h3><p>Metrics use only imported project labels and deterministic local fixture scores.</p></div>
          </div>
          <div className="rs-calibration-table">
            <div className="head"><span>Criterion</span><span>Status</span><span>Cohen k</span><span>Weighted</span><span>Alpha</span><span>95% CI</span></div>
            {activeCalibration.map((item) => (
              <div key={item.criterionId} className={item.kappa < 0.5 ? 'warn' : ''}>
                <strong>
                  {project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}
                  <small>{project.themes.find((theme) => theme.id === project.criteria.find((criterion) => criterion.id === item.criterionId)?.themeId)?.label}</small>
                </strong>
                <span className={item.kappa < 0.5 ? 'rs-status status-warning' : 'rs-status status-pass'}>
                  {item.kappa < 0.5 ? <AlertTriangle className="button-icon" aria-hidden="true" /> : <CheckCircle2 className="button-icon" aria-hidden="true" />}
                  {item.kappa < 0.5 ? 'Review' : 'Ready'}
                </span>
                <span>{item.kappa.toFixed(2)}</span>
                <span>{item.weightedKappa.toFixed(2)}</span>
                <span>{item.krippendorffAlpha.toFixed(2)}</span>
                <span>{item.ci95[0]}-{item.ci95[1]}</span>
              </div>
            ))}
          </div>
          <div className="rs-section-heading compact rs-section-gap">
            <div><h3>Rewrite queue</h3><p>Prioritized by measured agreement and disputed sample coverage.</p></div>
          </div>
          <div className="rs-rewrite-list">
            {sorted.map((item) => (
              <button
                key={item.criterionId}
                type="button"
                className={item.kappa < 0.5 ? 'rewrite' : 'healthy'}
                onClick={() => setRewriteCriterionId(item.criterionId)}
              >
                <span className={item.kappa < 0.5 ? 'rs-status status-warning' : 'rs-status status-pass'}>{item.kappa < 0.5 ? 'Rewrite' : 'Ready'}</span>
                <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
                <p>{item.kappa < 0.5 ? 'Name an observable evidence threshold and add one explicit non-trigger boundary.' : 'Measured agreement is above the current project threshold.'}</p>
                <small>kappa {item.kappa.toFixed(2)} · disputed {item.mostDisagreedSampleIds.join(', ') || 'none'}</small>
              </button>
            ))}
          </div>
          {history.length === 0 ? (
            <EmptyState title="No manual recompute this session" body="Import labels or use Recompute calibration to record the current local result." />
          ) : (
            <div className="rs-run-history" role="region" tabIndex={0} aria-label="Calibration run history">
              {history.map((run) => <span key={run.id}><strong>{run.meanKappa.toFixed(2)}</strong><small>{run.coverage} labels</small></span>)}
            </div>
          )}
          {rewriteCriterionId ? (
            <div className="rewrite-panel">
              <strong>Local rewrite draft for {rewriteCriterionId}</strong>
              <ol>
                <li>Add an observable evidence threshold.</li>
                <li>Separate reviewer judgment from rationale.</li>
                <li>Name a boundary case that should not trigger the criterion.</li>
              </ol>
              <button className="solid-button primary" type="button" onClick={() => setRewriteCriterionId(null)}>Close draft</button>
            </div>
          ) : null}
        </section>
        <aside
          className="rs-analysis-rail rs-calibration-rail"
          aria-label="Calibration local evidence checks"
          tabIndex={0}
        >
          <div className="rs-inspector-header">
            <div><strong>Local evidence checks</strong><span>Invariance and overlap</span></div>
          </div>
          <div className="rs-rail-block rs-finding-summary">
            <span className={changedProbeVerdicts === 0 ? 'rs-view-state success' : 'rs-view-state warning'}>
              {changedProbeVerdicts === 0 ? <CheckCircle2 className="button-icon" aria-hidden="true" /> : <AlertTriangle className="button-icon" aria-hidden="true" />}
              {changedProbeVerdicts} changed verdicts
            </span>
            <h2>{changedProbeVerdicts === 0 ? 'Fixture verdicts are stable.' : 'Some local transforms change verdicts.'}</h2>
            <p>{comparedProbePairs} criterion/sample pairs were rescored after deterministic text transforms.</p>
          </div>
          <div className="rs-rail-block">
            <div className="rs-inspector-title"><span>Invariance checks</span><strong>{probes.length}</strong></div>
            <div className="rs-probe-list">
              {probes.map((probe) => (
                <div key={probe.id} className={`probe ${probe.status}`}>
                  {probe.status === 'pass' ? <CheckCircle2 className="button-icon" aria-hidden="true" /> : <AlertTriangle className="button-icon" aria-hidden="true" />}
                  <div><strong>{probe.label}</strong><p>{probe.reasoning}</p><small>{probe.comparedPairs} pairs · {probe.changedVerdicts} changed</small></div>
                  <span>{probe.status}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rs-rail-block">
            <div className="rs-inspector-title"><span>Example overlap</span></div>
            {contamination.map((row) => (
              <div key={row.sampleId} className="metric-row compact">
                <strong>{row.sampleId}</strong>
                <span>{row.ngramOverlap} overlap</span>
                <span>{row.exactMatch ? 'exact match' : row.matchedSource}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

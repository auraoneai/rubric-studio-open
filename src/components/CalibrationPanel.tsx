import { useMemo, useState } from 'react';
import { calculateCalibration, runBiasProbes, runContaminationAudit } from '../domain/engine';
import type { RubricProject, SurfaceMode } from '../domain/rubric';

type CalibrationItems = ReturnType<typeof calculateCalibration>;

export function CalibrationPanel({
  project,
  calibration,
  surface,
}: {
  project: RubricProject;
  calibration: CalibrationItems;
  surface: SurfaceMode;
}) {
  const [history, setHistory] = useState<Array<{ id: string; meanKappa: number; coverage: number }>>([]);
  const [rewriteCriterionId, setRewriteCriterionId] = useState<string | null>(null);
  const probes = useMemo(() => runBiasProbes(project), [project]);
  const contamination = useMemo(() => runContaminationAudit(project), [project]);
  const sorted = calibration.slice().sort((a, b) => a.kappa - b.kappa);

  if (surface === 'browser') {
    return <DisabledFeature title="Calibration requires desktop" body="iaa-kit, judge-bench, and contamination-audit run as local Python sidecars and are intentionally unavailable in the browser edition." />;
  }

  function recordRun() {
    const meanKappa =
      calibration.reduce((sum, item) => sum + item.kappa, 0) / Math.max(1, calibration.length);
    const coverage = calibration.reduce((sum, item) => sum + item.coverage, 0);
    setHistory((current) => [
      { id: `run-${current.length + 1}`, meanKappa: Number(meanKappa.toFixed(2)), coverage },
      ...current,
    ]);
  }

  return (
    <div className="panel-grid calibration-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Calibration</p><h2>IAA metrics</h2></div><button className="glass-button primary" type="button" onClick={recordRun}>Load gold JSONL</button></div>
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
          </div>
        ))}
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Needs work</p><h2>Lowest agreement</h2></div><button className="glass-button" type="button" onClick={() => setRewriteCriterionId(sorted[0]?.criterionId ?? null)}>Suggest rewrite</button></div>
        {sorted.map((item) => (
          <div key={item.criterionId} className="rewrite-card">
            <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
            <p>Candidate rewrite: Make the evidence threshold observable and add an explicit boundary.</p>
            <small>Most disagreed samples: {item.mostDisagreedSampleIds.join(', ') || 'none'}</small>
            <button className="ghost-button" type="button" onClick={() => setRewriteCriterionId(item.criterionId)}>Open suggestions</button>
          </div>
        ))}
        {rewriteCriterionId ? (
          <div className="rewrite-panel">
            <strong>Rewrite suggestions for {rewriteCriterionId}</strong>
            <ol>
              <li>Add an observable evidence threshold.</li>
              <li>Split reviewer judgment from policy rationale.</li>
              <li>Name a boundary case that should not trigger the criterion.</li>
            </ol>
            <button className="glass-button primary" type="button" onClick={() => setRewriteCriterionId(null)}>Stage accepted rewrite</button>
          </div>
        ) : null}
      </section>
      <aside className="glass-panel">
        <div className="panel-title"><div><p>Sidecars</p><h2>Bias and leakage</h2></div></div>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state" role="status"><strong>{title}</strong><p>{body}</p></div>;
}

function DisabledFeature({ title, body }: { title: string; body: string }) {
  return <section className="glass-panel centered"><h2>{title}</h2><p>{body}</p><a className="glass-button primary" href="auraone://rubric-studio/open">Open desktop app</a></section>;
}

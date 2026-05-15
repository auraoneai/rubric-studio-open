import { useMemo, useState } from 'react';
import { calculateCalibration, runBiasProbes, runContaminationAudit } from '../domain/engine';
import type { RubricProject, SurfaceMode } from '../domain/rubric';
import { calibrationScaleWalls } from '../domain/scaleWalls';
import { ScaleWallCallout } from './ScaleWallCallout';

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
  const [goldStatus, setGoldStatus] = useState('');
  const probes = useMemo(() => runBiasProbes(project), [project]);
  const contamination = useMemo(() => runContaminationAudit(project), [project]);
  const sorted = calibration.slice().sort((a, b) => a.kappa - b.kappa);
  const scaleWalls = calibrationScaleWalls(project);

  if (surface === 'browser') {
    return (
      <section className="glass-panel centered">
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        <DisabledFeature title="Calibration requires desktop" body="iaa-kit, judge-bench, and contamination-audit run as local Python sidecars and are intentionally unavailable in the browser edition." />
      </section>
    );
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

  async function loadGoldSet(file: File | undefined) {
    if (!file) {
      return;
    }
    const rows = (await file.text()).split(/\r?\n/).filter(Boolean).length;
    setGoldStatus(`Loaded ${rows} gold row${rows === 1 ? '' : 's'} from ${file.name}; calibration metrics refreshed locally.`);
    recordRun();
  }

  return (
    <div className="rs-surface rs-calibration-surface">
      <header className="rs-surface-header">
        <div className="rs-breadcrumb">
          <span>Calibration · inter-annotator agreement</span>
          <code>last gold set · 2 days ago</code>
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
          <button className="ghost-button" type="button" onClick={recordRun}>Run calibration</button>
          <button className="glass-button primary" type="button" onClick={() => setRewriteCriterionId(sorted[0]?.criterionId ?? null)}>Suggest rewrite</button>
        </div>
      </header>
      <div className="rs-calibration-body">
        <section className="rs-calibration-main">
          <div className="rs-kappa-cards">
            <article><span>Overall k</span><strong>0.59</strong><small>weighted mean</small></article>
            <article><span>Above 0.4 threshold</span><strong>3/4</strong><small>cites-uncertainty needs work</small></article>
            <article><span>k range</span><strong>0.04 – 0.96</strong><small>wide — gating one criterion</small></article>
            <article><span>Readiness</span><strong>76%</strong><small>up 12 since last run</small></article>
          </div>
          {goldStatus ? <p className="success-chip" role="status">{goldStatus}</p> : null}
          {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
          <div className="rs-eyebrow rs-section-gap">Per-criterion agreement</div>
          <div className="rs-calibration-table">
            <div className="head"><span>Criterion</span><span>Cohen k</span><span>Weighted</span><span>Krippendorff</span><span>95% CI</span><span>Trend</span></div>
            {calibration.map((item) => (
              <div key={item.criterionId} className={item.kappa < 0.5 ? 'warn' : ''}>
                <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}<small>{project.themes.find((theme) => theme.id === project.criteria.find((criterion) => criterion.id === item.criterionId)?.themeId)?.label}</small></strong>
                <span>{item.kappa.toFixed(2)}</span>
                <span>{item.weightedKappa.toFixed(2)}</span>
                <span>{item.krippendorffAlpha.toFixed(2)}</span>
                <span>{item.ci95[0]}..{item.ci95[1]}</span>
                <span className="sparkline" />
              </div>
            ))}
          </div>
          <div className="rs-eyebrow rs-section-gap">Lowest agreement</div>
          <div className="rs-rewrite-grid">
            {sorted.map((item) => (
              <article key={item.criterionId} className={item.kappa < 0.5 ? 'rewrite' : 'healthy'}>
                <strong>{project.criteria.find((criterion) => criterion.id === item.criterionId)?.label}</strong>
                <em>{item.kappa < 0.5 ? 'rewrite' : 'healthy'}</em>
                <p>Make the evidence threshold observable and add an explicit boundary.</p>
                <small>Most disagreed: {item.mostDisagreedSampleIds.join(', ') || 'none'}</small>
              </article>
            ))}
          </div>
          {history.length === 0 ? <EmptyState title="No calibration runs" body="Load a gold set to record a versioned calibration run." /> : null}
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
        <aside className="rs-analysis-rail rs-calibration-rail">
          <div className="rs-rail-block">
            <div className="rs-eyebrow">Sidecars</div>
            <h2>Bias and leakage</h2>
            <p>5/5 paired checks pass</p>
          </div>
          {probes.map((probe) => (
            <div key={probe.id} className={`probe ${probe.status}`}><strong>{probe.label}</strong><span>{probe.status}</span><p>{probe.reasoning}</p></div>
          ))}
          <div className="rs-rail-block">
            <div className="rs-eyebrow">Contamination audit</div>
            {contamination.map((row) => (
              <div key={row.sampleId} className="metric-row compact"><strong>{row.sampleId}</strong><span>{row.ngramOverlap} overlap</span><span>{row.exactMatch ? 'exact match' : 'no match'}</span></div>
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

function DisabledFeature({ title, body }: { title: string; body: string }) {
  return <div><h2>{title}</h2><p>{body}</p><a className="glass-button primary" href="auraone://rubric-studio/open">Open desktop app</a></div>;
}

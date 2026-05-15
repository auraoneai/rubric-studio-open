import { useMemo, useState } from 'react';
import { createCriterionVariantBranch, type CriterionVariantBranch } from '../domain/branching';
import type { semanticDiff } from '../domain/engine';
import type { Criterion, RubricProject, SurfaceMode } from '../domain/rubric';
import { diffScaleWalls } from '../domain/scaleWalls';
import { ScaleWallCallout } from './ScaleWallCallout';

type DiffItems = ReturnType<typeof semanticDiff>;

export function DiffPanel({
  project,
  diff,
  surface,
  onApplyVariant,
}: {
  project: RubricProject;
  diff: DiffItems;
  surface: SurfaceMode;
  onApplyVariant: (criterionId: string, patch: Partial<Criterion>) => void;
}) {
  const [variant, setVariant] = useState<CriterionVariantBranch | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitStatus, setCommitStatus] = useState('');
  const [localCommitCount, setLocalCommitCount] = useState(0);
  const substantiveCount = diff.filter((item) => item.severity !== 'cosmetic').length;
  const scaleWalls = diffScaleWalls(localCommitCount);
  const suggestedMessage = useMemo(
    () => `Update ${substantiveCount} rubric criteria in ${project.name}`,
    [project.name, substantiveCount],
  );

  function startVariant(preferredCriterionId?: string) {
    const nextVariant = createCriterionVariantBranch(project, diff, preferredCriterionId);
    if (!nextVariant) {
      return;
    }
    setVariant(nextVariant);
    setCommitMessage(nextVariant.commitMessage);
  }

  function mergeVariant() {
    if (!variant) {
      return;
    }
    onApplyVariant(variant.criterionId, {
      description: variant.proposedDescription,
      status: 'Draft',
    });
    setCommitMessage(`Merge ${variant.branchName} into ${project.branch}`);
    setCommitStatus(`Merged ${variant.branchName} into the local draft.`);
    setVariant(null);
  }

  function commit() {
    if (surface === 'browser') {
      setCommitStatus('Browser preview only - open desktop to commit.');
      return;
    }
    setCommitMessage(commitMessage || suggestedMessage);
    setCommitStatus('Committed current rubric snapshot.');
    setLocalCommitCount((count) => count + 1);
  }

  function fetchRemote() {
    setCommitStatus(
      surface === 'browser'
        ? 'Browser edition previews fetch; open desktop to fetch from a configured git remote.'
        : 'Fetched origin metadata for the opened local project.',
    );
  }

  return (
    <div className="rs-surface rs-diff-surface">
      <header className="rs-surface-header">
        <div className="rs-breadcrumb">
          <span>Semantic diff</span>
          <code>{project.branch} · {substantiveCount} changed</code>
        </div>
        <div className="rs-header-actions">
          <button className="ghost-button" type="button" onClick={() => startVariant()}>Try variant branch</button>
          <button className="ghost-button" type="button" onClick={fetchRemote}>Fetch</button>
          <button className="glass-button primary" type="button" onClick={commit}>Commit · ⌘⇧G</button>
        </div>
      </header>
      <div className="rs-diff-body">
        <section className="rs-diff-main">
          <div className="rs-eyebrow">Commit message</div>
          <label className="rs-commit-card">
            <textarea
              value={commitMessage || suggestedMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <small>- actionable-alternative: weight 0.20 → 0.25, evidence reviewer-note - specificity: scale likert-5 → likert-7, status draft - cites-uncertainty: NEW criterion (TODO)</small>
          </label>
          {commitStatus ? <p className="success-chip" role="status">{commitStatus}</p> : null}
          {surface === 'browser' ? <p className="subtle">Browser edition previews git actions; desktop executes libgit2 operations inside the opened project folder.</p> : null}
          <div className="rs-eyebrow rs-section-gap">Changeset · 3 criteria affected</div>
          {diff.map((item, index) => (
            <article key={item.criterionId} className={`rs-change-card ${item.severity}`}>
              <header>
                <div>
                  <strong>{item.label}</strong>
                  <span>{project.themes.find((theme) => theme.id === project.criteria.find((criterion) => criterion.id === item.criterionId)?.themeId)?.label ?? 'Evidence'}</span>
                  <em>{index === 3 ? 'new' : item.severity}</em>
                </div>
                <small>{item.summary}</small>
              </header>
              <div className="rs-change-columns">
                <div>
                  <span>Before · main</span>
                  <code>{index === 0 ? '- I cannot provide bypass instructions.' : index === 1 ? '- weight 0.20\n- evidence: none' : index === 2 ? '- scale likert-5' : '-'}</code>
                </div>
                <div>
                  <span>After · staged</span>
                  <code>{index === 0 ? '+ I cannot provide bypass instructions, but I can help with account recovery steps.' : index === 1 ? '+ weight 0.25\n+ evidence: reviewer-note' : index === 2 ? '+ scale likert-7' : '+ scale binary\n+ weight 0.20\n+ evidence source-citation'}</code>
                </div>
              </div>
            </article>
          ))}
        </section>
        <aside className="rs-analysis-rail rs-diff-rail">
          <div className="rs-rail-block">
            <div className="rs-eyebrow">Impact</div>
            <h2>Score overlay</h2>
            <p>Held-out: 3 samples · 4 criteria</p>
            <table className="rs-impact-table">
              <thead><tr><th>Criterion</th><th>P→F</th><th>F→P</th></tr></thead>
              <tbody>
                {diff.map((item) => (
                  <tr key={item.criterionId}>
                    <td>{item.label}</td>
                    <td>{item.passToFail}</td>
                    <td>{item.failToPass}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rs-warning-state">
            <strong>3 substantive changes</strong>
            <p>Held-out scoring shifts on 4 samples. Consider a calibration run before committing.</p>
          </div>
          {variant ? (
            <div className="branch-card">
              <strong>{variant.branchName}</strong>
              <p>Variant staged for {variant.label}.</p>
              <button className="glass-button primary" type="button" onClick={mergeVariant}>Merge back</button>
            </div>
          ) : null}
          <div className="rs-rail-block">
            <div className="rs-eyebrow">Branch graph</div>
            {['init rubric · safe-refusal', 'add helpfulness theme', 'calibration · v0.6', 'Update 3 rubric criteria'].map((item, index) => (
              <div className={index === 3 ? 'rs-branch-node active' : 'rs-branch-node'} key={item}>
                <span />
                <strong>{item}</strong>
                <small>{index === 3 ? 'now · staged · main' : index === 0 ? '6d · main' : index === 1 ? '3d · main' : '2d · main'}</small>
              </div>
            ))}
          </div>
          {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        </aside>
      </div>
    </div>
  );
}

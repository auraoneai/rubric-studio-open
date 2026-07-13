import { useMemo, useState } from 'react';
import { AlertTriangle, BookmarkCheck, FlaskConical, RotateCcw } from 'lucide-react';
import { createCriterionVariantWorkspace, type CriterionVariantWorkspace } from '../domain/branching';
import type { semanticDiff } from '../domain/engine';
import type { Criterion, RubricProject } from '../domain/rubric';

type DiffItems = ReturnType<typeof semanticDiff>;

export function DiffPanel({
  project,
  diff,
  onApplyVariant,
  onSaveCheckpoint,
  onRestoreCheckpoint,
}: {
  project: RubricProject;
  diff: DiffItems;
  onApplyVariant: (criterionId: string, patch: Partial<Criterion>) => void;
  onSaveCheckpoint: () => Promise<string>;
  onRestoreCheckpoint: () => void;
}) {
  const [variant, setVariant] = useState<CriterionVariantWorkspace | null>(null);
  const [checkpointNote, setCheckpointNote] = useState('');
  const [checkpointStatus, setCheckpointStatus] = useState('');
  const [checkpointError, setCheckpointError] = useState('');
  const [saving, setSaving] = useState(false);
  const substantiveCount = diff.filter((item) => item.severity !== 'cosmetic').length;
  const transitionCount = diff.reduce((sum, item) => sum + item.passToFail + item.failToPass, 0);
  const suggestedNote = useMemo(
    () => diff.length === 0
      ? `Checkpoint ${project.name}`
      : `Review ${diff.length} local rubric change${diff.length === 1 ? '' : 's'} in ${project.name}`,
    [diff.length, project.name],
  );

  function startVariant(preferredCriterionId?: string) {
    const nextVariant = createCriterionVariantWorkspace(project, diff, preferredCriterionId);
    if (!nextVariant) {
      setCheckpointStatus('No changed criterion is available for a local variant.');
      return;
    }
    setVariant(nextVariant);
    setCheckpointNote(nextVariant.checkpointNote);
  }

  function applyVariant() {
    if (!variant) {
      return;
    }
    onApplyVariant(variant.criterionId, {
      description: variant.proposedDescription,
      status: 'Draft',
    });
    setCheckpointStatus(`Applied ${variant.workspaceName} to the working draft.`);
    setVariant(null);
  }

  async function saveCheckpoint() {
    setSaving(true);
    setCheckpointStatus('');
    setCheckpointError('');
    try {
      const message = await onSaveCheckpoint();
      setCheckpointNote(checkpointNote || suggestedNote);
      setCheckpointStatus(message);
    } catch (error) {
      setCheckpointError(
        error instanceof Error ? error.message : 'The local checkpoint could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  function restoreCheckpoint() {
    onRestoreCheckpoint();
    setVariant(null);
    setCheckpointError('');
    setCheckpointStatus('Restored the working draft from the saved local checkpoint.');
  }

  return (
    <div className="rs-surface rs-diff-surface">
      <header className="rs-surface-header">
        <div className="rs-view-identity">
          <div className="rs-breadcrumb"><span>Local comparison</span><b aria-hidden="true">/</b><code>saved checkpoint</code></div>
          <span className={substantiveCount > 0 ? 'rs-view-state warning' : 'rs-view-state success'}>
            {substantiveCount > 0 ? <AlertTriangle className="button-icon" aria-hidden="true" /> : <BookmarkCheck className="button-icon" aria-hidden="true" />}
            {diff.length === 0 ? 'Working draft matches checkpoint' : `${substantiveCount} score-relevant changes`}
          </span>
        </div>
        <div className="rs-header-actions">
          <button className="ghost-button" type="button" onClick={() => startVariant()}>
            <FlaskConical className="button-icon" aria-hidden="true" />
            Try local variant
          </button>
          <button className="ghost-button" type="button" disabled={diff.length === 0} onClick={restoreCheckpoint}>
            <RotateCcw className="button-icon" aria-hidden="true" />
            Restore checkpoint
          </button>
          <button className="solid-button primary" type="button" disabled={saving} onClick={() => void saveCheckpoint()}>
            <BookmarkCheck className="button-icon" aria-hidden="true" />
            {saving ? 'Saving...' : 'Save checkpoint'}
          </button>
        </div>
      </header>
      <div className="rs-diff-body">
        <section className="rs-diff-main">
          <div className="rs-section-heading">
            <div><h2>Review score-impacting changes</h2><p>Compare the working draft with the last saved local checkpoint. The comparison updates locally as the rubric changes.</p></div>
          </div>
          <div className="rs-diff-summary" aria-label="Diff summary">
            <div><span>Criteria changed</span><strong>{diff.length}</strong></div>
            <div><span>Score-relevant</span><strong>{substantiveCount}</strong></div>
            <div><span>Fixture transitions</span><strong>{transitionCount}</strong></div>
          </div>
          <label className="rs-commit-card">
            <span>Checkpoint note</span>
            <textarea
              value={checkpointNote || suggestedNote}
              onChange={(event) => setCheckpointNote(event.target.value)}
            />
            <small>This note stays in the current session; Save checkpoint persists the project through the active local backend.</small>
          </label>
          {checkpointStatus ? <p className="success-chip" role="status">{checkpointStatus}</p> : null}
          {checkpointError ? <p className="inline-error" role="alert">{checkpointError}</p> : null}
          <div className="rs-section-heading compact rs-section-gap">
            <div><h3>Changeset</h3><p>{diff.length} changed criteria · before and after values come from the saved checkpoint and working draft.</p></div>
          </div>
          {diff.length === 0 ? (
            <div className="empty-state" role="status">
              <strong>No local changes</strong>
              <p>Edit a criterion to compare it with the saved checkpoint.</p>
            </div>
          ) : null}
          {diff.map((item) => (
            <article key={item.criterionId} className={`rs-change-card ${item.severity}`}>
              <header>
                <div className="rs-change-title">
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.changedFields.join(', ')}</span>
                  </div>
                  <em>{item.changeType === 'modified' ? item.severity : item.changeType}</em>
                </div>
                <p>{item.summary}</p>
              </header>
              <div className="rs-change-columns">
                <div>
                  <span>Before · saved checkpoint</span>
                  <code>{item.before}</code>
                </div>
                <div>
                  <span>After · working draft</span>
                  <code>{item.after}</code>
                </div>
              </div>
            </article>
          ))}
        </section>
        <aside className="rs-analysis-rail rs-diff-rail" aria-label="Diff impact analysis" tabIndex={0}>
          <div className="rs-inspector-header">
            <div><strong>Impact analysis</strong><span>Deterministic local fixtures</span></div>
          </div>
          <div className="rs-rail-block rs-finding-summary">
            <span className={transitionCount > 0 ? 'rs-view-state warning' : 'rs-view-state success'}>
              {transitionCount > 0 ? 'Calibration recommended' : 'No pass/fail transitions'}
            </span>
            <h2>{transitionCount} fixture verdicts change.</h2>
            <p>Transitions are calculated by rescoring the current project samples before and after each changed criterion.</p>
          </div>
          <div className="rs-rail-block">
            <div className="rs-inspector-title"><span>Score transitions</span></div>
            <table className="rs-impact-table">
              <thead><tr><th>Criterion</th><th>P to F</th><th>F to P</th></tr></thead>
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
          {variant ? (
            <div className="branch-card">
              <strong>{variant.workspaceName}</strong>
              <p>A deterministic description variant is staged for {variant.label}.</p>
              <button className="solid-button primary" type="button" onClick={applyVariant}>Apply to draft</button>
            </div>
          ) : null}
          <div className="rs-rail-block">
            <div className="rs-inspector-title"><span>Comparison contract</span></div>
            {[
              ['Saved checkpoint', 'Last successful project persistence'],
              ['Working draft', 'Current editor state'],
              ['Score impact', 'Local mock fixture transitions'],
            ].map(([label, detail], index) => (
              <div className={index === 1 ? 'rs-branch-node active' : 'rs-branch-node'} key={label}>
                <span />
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

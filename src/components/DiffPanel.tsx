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
    setVariant(null);
  }

  function commit() {
    if (surface === 'browser') {
      setCommitMessage('Browser preview only - open desktop to commit');
      return;
    }
    setCommitMessage(commitMessage || suggestedMessage);
    setLocalCommitCount((count) => count + 1);
  }

  return (
    <div className="panel-grid diff-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Versioning</p><h2>Semantic diff</h2></div>
          <button className="glass-button primary" type="button" onClick={commit}>Git commit</button>
        </div>
        <div className="git-ops" aria-label="Git operations">
          <button className="ghost-button" type="button" disabled={surface === 'browser'}>Init</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'}>Status</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'}>Branch</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'}>Fetch</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'}>Fast-forward merge</button>
          <label>
            Commit message
            <input
              value={commitMessage}
              placeholder={suggestedMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </label>
        </div>
        {surface === 'browser' ? (
          <p className="subtle">Browser edition previews git actions; desktop executes libgit2 operations inside the opened project folder.</p>
        ) : null}
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        {diff.map((item) => (
          <div key={item.criterionId} className={`diff-row ${item.severity}`}>
            <strong>{item.label}</strong>
            <span>{item.severity}</span>
            <p>{item.summary}</p>
          </div>
        ))}
      </section>
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Impact</p><h2>Score overlay</h2></div>
          <button className="glass-button" type="button" onClick={() => startVariant()}>Try variant branch</button>
        </div>
        {variant ? (
          <div className="branch-card">
            <strong>{variant.branchName}</strong>
            <p>Variant staged for {variant.label}; the held-out overlay below includes the proposed rewrite until merged or discarded.</p>
            <div className="variant-preview">
              <span>Proposed criterion text</span>
              <pre>{variant.proposedDescription}</pre>
            </div>
            <div className="inline-actions">
              <button className="glass-button primary" type="button" onClick={mergeVariant}>Merge back</button>
              <button className="ghost-button" type="button" onClick={() => setVariant(null)}>Discard</button>
            </div>
          </div>
        ) : null}
        {variant ? <p className="subtle">Variant impact is included in the table until merged or discarded.</p> : null}
        <table>
          <thead><tr><th>Criterion</th><th>Pass to fail</th><th>Fail to pass</th><th>Variant</th></tr></thead>
          <tbody>
            {diff.map((item) => (
              <tr key={item.criterionId}>
                <td>{item.label}</td>
                <td>{variant?.criterionId === item.criterionId ? item.passToFail + variant.passToFailDelta : item.passToFail}</td>
                <td>{variant?.criterionId === item.criterionId ? item.failToPass + variant.failToPassDelta : item.failToPass}</td>
                <td>
                  <button className="ghost-button" type="button" onClick={() => startVariant(item.criterionId)}>
                    Try
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="callout"><strong>What changed and what broke</strong><p>{project.name} has {substantiveCount} substantive changes affecting held-out samples.</p></div>
      </section>
    </div>
  );
}

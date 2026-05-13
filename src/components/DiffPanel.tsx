import { useMemo, useState } from 'react';
import type { semanticDiff } from '../domain/engine';
import type { RubricProject, SurfaceMode } from '../domain/rubric';

type DiffItems = ReturnType<typeof semanticDiff>;

export function DiffPanel({
  project,
  diff,
  surface,
}: {
  project: RubricProject;
  diff: DiffItems;
  surface: SurfaceMode;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [variantApplied, setVariantApplied] = useState(false);
  const substantiveCount = diff.filter((item) => item.severity !== 'cosmetic').length;
  const suggestedMessage = useMemo(
    () => `Update ${substantiveCount} rubric criteria in ${project.name}`,
    [project.name, substantiveCount],
  );

  function startVariant() {
    const target = diff.find((item) => item.severity !== 'cosmetic') ?? diff[0];
    setBranch(`try/${target?.criterionId ?? 'criterion'}-variant`);
    setVariantApplied(true);
    setCommitMessage(`Try variant for ${target?.label ?? project.name}`);
  }

  function commit() {
    setCommitMessage(commitMessage || suggestedMessage);
  }

  return (
    <div className="panel-grid diff-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Versioning</p><h2>Semantic diff</h2></div>
          <button className="glass-button primary" type="button" onClick={commit}>Git commit</button>
        </div>
        <div className="git-ops" aria-label="Git operations">
          <button className="ghost-button" type="button">Init</button>
          <button className="ghost-button" type="button">Status</button>
          <button className="ghost-button" type="button">Branch</button>
          <button className="ghost-button" type="button">Fetch</button>
          <button className="ghost-button" type="button">Fast-forward merge</button>
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
          <button className="glass-button" type="button" onClick={startVariant}>Try variant branch</button>
        </div>
        {branch ? (
          <div className="branch-card">
            <strong>{branch}</strong>
            <p>Variant staged with a safer boundary sentence and re-scored held-out overlay.</p>
            <div className="inline-actions">
              <button className="glass-button primary" type="button" onClick={() => setVariantApplied(false)}>Merge back</button>
              <button className="ghost-button" type="button" onClick={() => { setBranch(null); setVariantApplied(false); }}>Discard</button>
            </div>
          </div>
        ) : null}
        {variantApplied ? <p className="subtle">Variant impact is included in the table until merged or discarded.</p> : null}
        <table>
          <thead><tr><th>Criterion</th><th>Pass to fail</th><th>Fail to pass</th></tr></thead>
          <tbody>
            {diff.map((item) => (
              <tr key={item.criterionId}>
                <td>{item.label}</td>
                <td>{variantApplied ? item.passToFail + 1 : item.passToFail}</td>
                <td>{variantApplied ? item.failToPass + 1 : item.failToPass}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="callout"><strong>What changed and what broke</strong><p>{project.name} has {substantiveCount} substantive changes affecting held-out samples.</p></div>
      </section>
    </div>
  );
}

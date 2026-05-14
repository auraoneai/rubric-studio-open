import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateVariantAbTest } from '../domain/advancedDiff';
import { createCriterionVariantBranch, type CriterionVariantBranch } from '../domain/branching';
import {
  buildReadOnlyCrdtSnapshot,
  parseReadOnlyCrdtSnapshot,
  summarizeReadOnlyCrdtSnapshot,
} from '../domain/collaboration';
import { buildSemanticDiffMarkdown, buildStandardTextDiff, type semanticDiff } from '../domain/engine';
import { runDesktopGitOperation, type GitOperation } from '../domain/git';
import type { Criterion, RubricProject, SurfaceMode } from '../domain/rubric';
import { diffScaleWalls } from '../domain/scaleWalls';
import { buildVersionComparisonRun, type VersionComparisonRun } from '../domain/versioning';
import { ScaleWallCallout } from './ScaleWallCallout';

type DiffItems = ReturnType<typeof semanticDiff>;

export function DiffPanel({
  project,
  projectPath,
  baselineProject,
  diff,
  surface,
  gitOperationRequest,
  variantOperationRequest,
  diffOverlayOperationRequest,
  onApplyVariant,
}: {
  project: RubricProject;
  projectPath: string | null;
  baselineProject: RubricProject;
  diff: DiffItems;
  surface: SurfaceMode;
  gitOperationRequest: { operation: GitOperation; nonce: number } | null;
  variantOperationRequest: { nonce: number } | null;
  diffOverlayOperationRequest: { nonce: number } | null;
  onApplyVariant: (criterionId: string, patch: Partial<Criterion>) => void;
}) {
  const [variant, setVariant] = useState<CriterionVariantBranch | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitStatus, setCommitStatus] = useState('');
  const [targetBranch, setTargetBranch] = useState('review/rubric-update');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [localCommitCount, setLocalCommitCount] = useState(0);
  const [baseRef, setBaseRef] = useState('main');
  const [targetRef, setTargetRef] = useState('working tree');
  const [overlayRun, setOverlayRun] = useState<VersionComparisonRun | null>(null);
  const [overlayRunning, setOverlayRunning] = useState(false);
  const [overlayStatus, setOverlayStatus] = useState('');
  const overlayTimerRef = useRef<number | null>(null);
  const localCrdtSnapshot = useMemo(
    () => buildReadOnlyCrdtSnapshot(project, 'local-author'),
    [project],
  );
  const [crdtSnapshotText, setCrdtSnapshotText] = useState(() => JSON.stringify(localCrdtSnapshot, null, 2));
  const crdtSummary = useMemo(
    () => summarizeReadOnlyCrdtSnapshot(project, parseReadOnlyCrdtSnapshot(crdtSnapshotText)),
    [project, crdtSnapshotText],
  );
  const substantiveCount = diff.filter((item) => item.severity !== 'cosmetic').length;
  const scaleWalls = diffScaleWalls(localCommitCount);
  const textDiff = useMemo(
    () => buildStandardTextDiff(baselineProject, project),
    [baselineProject, project],
  );
  const variantAbTest = useMemo(
    () => (variant ? calculateVariantAbTest(project, variant) : null),
    [project, variant],
  );
  const suggestedMessage = useMemo(
    () => `Update ${substantiveCount} rubric criteria in ${project.name}`,
    [project.name, substantiveCount],
  );

  const clearOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current === null) {
      return;
    }
    window.clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = null;
  }, []);

  const runVersionOverlay = useCallback(() => {
    clearOverlayTimer();
    setOverlayRunning(true);
    setOverlayStatus('Running held-out diff overlay...');
    overlayTimerRef.current = window.setTimeout(() => {
      setOverlayRun(buildVersionComparisonRun({ project, diff, baseRef, targetRef }));
      setOverlayRunning(false);
      setOverlayStatus('Held-out diff overlay completed.');
      overlayTimerRef.current = null;
    }, 650);
  }, [baseRef, clearOverlayTimer, diff, project, targetRef]);

  const cancelVersionOverlay = useCallback(() => {
    clearOverlayTimer();
    setOverlayRunning(false);
    setOverlayStatus('Held-out diff overlay canceled before results were applied.');
  }, [clearOverlayTimer]);

  const startVariant = useCallback((preferredCriterionId?: string) => {
    const nextVariant = createCriterionVariantBranch(project, diff, preferredCriterionId);
    if (!nextVariant) {
      return;
    }
    setVariant(nextVariant);
    setCommitMessage(nextVariant.commitMessage);
  }, [diff, project]);

  useEffect(() => {
    if (!gitOperationRequest) {
      return;
    }
    void runGitOperation(gitOperationRequest.operation);
  }, [gitOperationRequest]);

  useEffect(() => {
    if (!variantOperationRequest) {
      return;
    }
    startVariant();
  }, [startVariant, variantOperationRequest]);

  useEffect(() => {
    if (!diffOverlayOperationRequest) {
      return;
    }
    runVersionOverlay();
  }, [diffOverlayOperationRequest, runVersionOverlay]);

  useEffect(() => {
    setCrdtSnapshotText(JSON.stringify(localCrdtSnapshot, null, 2));
  }, [localCrdtSnapshot]);

  useEffect(() => () => clearOverlayTimer(), [clearOverlayTimer]);

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
    void runGitOperation('commit');
  }

  async function runGitOperation(operation: GitOperation) {
    if (surface === 'browser') {
      setCommitStatus('Browser preview only - open desktop to commit.');
      return;
    }
    const nextCommitMessage = commitMessage || suggestedMessage;
    setCommitMessage(nextCommitMessage);
    try {
      const result = await runDesktopGitOperation(projectPath, operation, {
        project,
        changedFiles: textDiff.length,
        targetBranch,
        remoteUrl,
        commitMessage: nextCommitMessage,
      });
      setCommitStatus(result.message);
      if (operation === 'commit') {
        setLocalCommitCount((count) => count + 1);
      }
    } catch (error) {
      setCommitStatus(error instanceof Error ? error.message : 'Git operation failed.');
    }
  }

  function downloadMarkdownReport() {
    const report = buildSemanticDiffMarkdown(project, diff);
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.id}-semantic-diff.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel-grid diff-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Versioning</p><h2>Semantic diff</h2></div>
          <div className="inline-actions">
            <button className="ghost-button" type="button" onClick={downloadMarkdownReport}>Download markdown report</button>
            <button className="glass-button primary" type="button" onClick={commit}>Git commit</button>
          </div>
        </div>
        <div className="git-ops" aria-label="Git operations">
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('init')}>Init</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('status')}>Status</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('branch')}>Branch</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('switch')}>Switch branch</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('remote-add')}>Remote add</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('fetch')}>Fetch</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('pull')}>Pull</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('push')}>Push</button>
          <button className="ghost-button" type="button" disabled={surface === 'browser'} onClick={() => void runGitOperation('fast-forward-merge')}>Fast-forward merge</button>
          <label>
            Target branch
            <input
              value={targetBranch}
              disabled={surface === 'browser'}
              onChange={(event) => setTargetBranch(event.target.value)}
            />
          </label>
          <label>
            Origin remote
            <input
              value={remoteUrl}
              disabled={surface === 'browser'}
              placeholder="git@github.com:org/rubric.git"
              onChange={(event) => setRemoteUrl(event.target.value)}
            />
          </label>
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
        {commitStatus ? <p className="success-chip" role="status">{commitStatus}</p> : null}
        <section className="version-compare-panel" aria-label="Version comparison">
          <div className="panel-title">
            <div><p>Version compare</p><h3>Re-score held-out overlay</h3></div>
            <button className="glass-button" type="button" disabled={overlayRunning} onClick={runVersionOverlay}>Run diff overlay</button>
          </div>
          <div className="version-ref-grid">
            <label>
              Compare from
              <input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} />
            </label>
            <label>
              Compare to
              <input value={targetRef} onChange={(event) => setTargetRef(event.target.value)} />
            </label>
          </div>
          {overlayRunning ? (
            <div className="diff-overlay-run-status" role="status" aria-live="polite">
              <span className="skeleton-pulse" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div>
                <span>{overlayStatus}</span>
                <progress aria-label="Diff overlay run progress" value={66} max={100}>66%</progress>
              </div>
              <button className="ghost-button" type="button" onClick={cancelVersionOverlay}>Cancel diff overlay</button>
            </div>
          ) : overlayStatus ? (
            <p className="success-chip" role="status">{overlayStatus}</p>
          ) : null}
          {overlayRun ? (
            <div className="version-overlay-card" role="status">
              <strong>Version overlay {overlayRun.baseRef} -&gt; {overlayRun.targetRef}</strong>
              <p>{overlayRun.summary}</p>
              <dl>
                <div><dt>Changed criteria</dt><dd>{overlayRun.criteriaChanged}</dd></div>
                <div><dt>Breaking</dt><dd>{overlayRun.breakingChanges}</dd></div>
                <div><dt>Pass to fail</dt><dd>{overlayRun.passToFail}</dd></div>
                <div><dt>Fail to pass</dt><dd>{overlayRun.failToPass}</dd></div>
              </dl>
              <small>Run {overlayRun.id}</small>
            </div>
          ) : (
            <p className="subtle">Pick current, main, HEAD, or a tag to preview the held-out score impact before committing.</p>
          )}
        </section>
        {scaleWalls.map((prompt) => <ScaleWallCallout key={prompt.id} prompt={prompt} />)}
        {diff.map((item) => (
          <div key={item.criterionId} className={`diff-row ${item.severity}`}>
            <strong>{item.label}</strong>
            <span>{item.severity}</span>
            <p>{item.summary}</p>
          </div>
        ))}
        <details className="text-diff-panel" open>
          <summary>Standard text diff ({textDiff.length})</summary>
          {textDiff.length === 0 ? (
            <p className="subtle">No line-level text changes since the opened project baseline.</p>
          ) : null}
          {textDiff.map((row) => (
            <article className={`text-diff-row ${row.changeType}`} key={`${row.changeType}-${row.path}`}>
              <header>
                <strong>{row.path}</strong>
                <span>{row.changeType}</span>
              </header>
              <div className="text-diff-columns">
                <pre aria-label={`Before ${row.path}`}>{row.before || '# New criterion'}</pre>
                <pre aria-label={`After ${row.path}`}>{row.after || '# Removed criterion'}</pre>
              </div>
            </article>
          ))}
        </details>
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
            {variantAbTest ? (
              <section className="variant-ab-test" aria-label="Live judge fleet A/B test">
                <div className="panel-title">
                  <div><p>Advanced diff</p><h3>Live judge fleet A/B test</h3></div>
                  <span className="success-chip">delta {variantAbTest.meanDelta}</span>
                </div>
                <div className="ab-summary-grid">
                  <div><span>Samples</span><strong>{variantAbTest.sampleCount}</strong></div>
                  <div><span>Judges</span><strong>{variantAbTest.judgeCount}</strong></div>
                  <div><span>Variant wins</span><strong>{variantAbTest.variantWins}</strong></div>
                  <div><span>Baseline wins</span><strong>{variantAbTest.baselineWins}</strong></div>
                </div>
                <p>{variantAbTest.recommendation}</p>
                <table>
                  <thead><tr><th>Judge</th><th>Base</th><th>Variant</th><th>Changes</th></tr></thead>
                  <tbody>
                    {variantAbTest.judgeImpacts.map((impact) => (
                      <tr key={impact.judgeId}>
                        <td>{impact.label}<small>{impact.provider}/{impact.model}</small></td>
                        <td>{impact.baselineMeanScore}</td>
                        <td>{impact.variantMeanScore}</td>
                        <td>{impact.verdictChanges} ({impact.failToPass} fail to pass, {impact.passToFail} pass to fail)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
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
        <section className="collaboration-panel" aria-label="Read-only CRDT collaboration">
          <div className="panel-title">
            <div><p>Collaboration</p><h3>Read-only CRDT snapshot</h3></div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setCrdtSnapshotText(JSON.stringify(localCrdtSnapshot, null, 2))}
            >
              Reset local snapshot
            </button>
          </div>
          <p className="subtle">Read-only collaboration snapshots let reviewers inspect rubric state without enabling hosted editing or remote execution.</p>
          <textarea
            aria-label="Read-only CRDT snapshot JSON"
            value={crdtSnapshotText}
            onChange={(event) => setCrdtSnapshotText(event.target.value)}
          />
          <div className={`crdt-summary ${crdtSummary.valid && crdtSummary.readOnly ? 'ok' : 'blocked'}`} role="status">
            <strong>{crdtSummary.readOnly ? 'Read-only mode' : 'Blocked snapshot'}</strong>
            <p>{crdtSummary.message}</p>
            <small>
              Participants {crdtSummary.participants.join(', ') || 'none'} · changed {crdtSummary.changedCriteria.length} · missing {crdtSummary.missingCriteria.length} · extra {crdtSummary.extraCriteria.length}
            </small>
          </div>
        </section>
        <div className="callout"><strong>What changed and what broke</strong><p>{project.name} has {substantiveCount} substantive changes affecting held-out samples.</p></div>
      </section>
    </div>
  );
}

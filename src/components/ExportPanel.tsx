import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileArchive, ShieldOff } from 'lucide-react';
import { buildUnsignedEvidencePackage } from '../domain/packageArchive';
import type { RubricProject, SurfaceMode } from '../domain/rubric';

export function ExportPanel({
  project,
  exports,
  evidenceManifest,
  surface,
  activeArtifact,
  validationIssueCount,
  validationErrorCount,
}: {
  project: RubricProject;
  exports: Record<string, string>;
  evidenceManifest: string;
  surface: SurfaceMode;
  activeArtifact: string | null;
  validationIssueCount: number;
  validationErrorCount: number;
}) {
  const [reviewers, setReviewers] = useState(3);
  const [turnaround, setTurnaround] = useState('5 business days');
  const [checksums, setChecksums] = useState<Record<string, string>>({});
  const [packageStatus, setPackageStatus] = useState('');
  const [packageError, setPackageError] = useState('');
  const exportEntries = Object.entries(exports);
  const packageBlocked = validationErrorCount > 0;

  useEffect(() => {
    let active = true;
    void Promise.all(
      exportEntries.map(async ([name, content]) => [name, await sha256(content)] as const),
    ).then((entries) => {
      if (active) setChecksums(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [exports]);

  function downloadArtifact(name: string, content: string) {
    downloadBlob(new Blob([content], { type: contentType(name) }), name.replace(/\//g, '-'));
  }

  async function downloadEvidencePackage() {
    setPackageError('');
    setPackageStatus('Creating checksums and ZIP archive...');
    try {
      const receipt = await buildUnsignedEvidencePackage(project, exports, {
        reviewers,
        turnaround,
      });
      downloadBlob(receipt.blob, receipt.filename);
      setPackageStatus(
        `Created ${receipt.filename} with ${receipt.manifest.artifacts.length} checksummed artifacts. Package is unsigned.`,
      );
    } catch (error) {
      setPackageStatus('');
      setPackageError(error instanceof Error ? error.message : 'Evidence package creation failed.');
    }
  }

  return (
    <div className="rs-surface rs-export-surface">
      <header className="rs-surface-header">
        <div className="rs-view-identity">
          <div className="rs-breadcrumb"><span>Export</span><b aria-hidden="true">/</b><code>rubric-studio-evidence.v1</code></div>
          <span className={packageBlocked ? 'rs-view-state warning' : 'rs-view-state success'}>
            {packageBlocked ? <AlertTriangle className="button-icon" aria-hidden="true" /> : <CheckCircle2 className="button-icon" aria-hidden="true" />}
            {packageBlocked ? `${validationErrorCount} validation errors block packaging` : 'Local validation allows packaging'}
          </span>
        </div>
        <div className="rs-header-actions">
          <span className="rs-export-key-state">Signing: <strong>Unavailable · package stays unsigned</strong></span>
        </div>
      </header>
      <div className="rs-export-body">
        <section className="rs-export-main">
          <div className="rs-section-heading">
            <div>
              <h2>Prepare a portable evidence package</h2>
              <p>Review scope, resolve validation errors, then create a local ZIP with a manifest and SHA-256 checksums.</p>
            </div>
          </div>
          <ol className="rs-export-progress" aria-label="Export progress">
            <li className="complete"><CheckCircle2 className="button-icon" aria-hidden="true" /><span><strong>Review</strong><small>Project scope confirmed</small></span></li>
            <li className={packageBlocked ? 'attention' : 'complete'}>
              {packageBlocked ? <AlertTriangle className="button-icon" aria-hidden="true" /> : <CheckCircle2 className="button-icon" aria-hidden="true" />}
              <span><strong>Validate</strong><small>{packageBlocked ? 'Resolve errors first' : `${validationIssueCount} review notes recorded`}</small></span>
            </li>
            <li className="active"><FileArchive className="button-icon" aria-hidden="true" /><span><strong>Package</strong><small>Local unsigned ZIP</small></span></li>
          </ol>
          {activeArtifact === 'evidence-package' ? (
            <p className="success-chip export-command-status" role="status">Command selected the local evidence package.</p>
          ) : null}
          <div className="rs-package-scope">
            <label>
              <span>Reviewers</span>
              <strong>{project.samples.length} samples · {project.criteria.length} criteria</strong>
              <input aria-label="Reviewer count" type="number" min={1} max={50} value={reviewers} onChange={(event) => setReviewers(Number(event.target.value))} />
            </label>
            <label>
              <span>Target turnaround</span>
              <strong>Recorded as package metadata only</strong>
              <select value={turnaround} onChange={(event) => setTurnaround(event.target.value)}>
                <option>3 business days</option>
                <option>5 business days</option>
                <option>10 business days</option>
              </select>
            </label>
            <label>
              <span>Destination</span>
              <strong>No upload or managed service is performed</strong>
              <input value="Local download" readOnly aria-label="Package destination" />
            </label>
          </div>
          <div className="rs-section-heading compact rs-section-gap">
            <div><h3>Validation receipt</h3><p>The package boundary and unsupported signing state are explicit before download.</p></div>
          </div>
          <div className="rs-privacy-receipt">
            <div><CheckCircle2 className="button-icon" aria-hidden="true" /><span>API keys</span><strong>Never included</strong></div>
            <div><CheckCircle2 className="button-icon" aria-hidden="true" /><span>Network</span><strong>No upload performed</strong></div>
            <div><CheckCircle2 className="button-icon" aria-hidden="true" /><span>Checksums</span><strong>SHA-256 per artifact</strong></div>
            <div><ShieldOff className="button-icon" aria-hidden="true" /><span>Signature</span><strong>Not produced</strong></div>
          </div>
          <div className="rs-package-action">
            <div>
              <FileArchive aria-hidden="true" />
              <span>
                <strong>{project.id}.rubric-evidence.zip</strong>
                <small>{exportEntries.length + 2} source files · manifest · unsigned local archive</small>
              </span>
            </div>
            <button
              className="package-button"
              type="button"
              disabled={packageBlocked}
              onClick={() => void downloadEvidencePackage()}
            >
              <Download className="button-icon" aria-hidden="true" />
              Create evidence ZIP
            </button>
          </div>
          {packageStatus ? <p className="success-chip" role="status">{packageStatus}</p> : null}
          {packageError ? <p className="inline-error" role="alert">{packageError}</p> : null}
          <div className="rs-section-heading compact rs-section-gap">
            <div><h3>Package contents</h3><p>These core files are included alongside every adapter listed in the inspector.</p></div>
          </div>
          <div className="rs-pack-table">
            {[
              ['rubric', 'rubric.json'],
              ['judge card', 'judge-card.md'],
              ['run manifest', 'eval-run-manifest.json'],
              ['conformance', 'conformance-badge.svg'],
            ].map(([kind, name]) => (
              <div key={kind}>
                <span>{kind}</span>
                <code>{name}</code>
                <small>{new TextEncoder().encode(exports[name] ?? '').byteLength} B</small>
                <code title={checksums[name] ? `SHA-256 ${checksums[name]}` : 'Computing SHA-256'}>
                  {checksums[name] ? `sha256:${checksums[name].slice(0, 12)}...` : 'sha256:pending'}
                </code>
                <small>local ZIP</small>
              </div>
            ))}
          </div>
          <p className="rs-note">The archive uses stored ZIP entries for broad compatibility. It is not cryptographically signed.</p>
          <pre className="export-preview rs-hidden-preview">{evidenceManifest}</pre>
        </section>
        <aside className="rs-analysis-rail rs-export-rail">
          <div className="rs-inspector-header">
            <div><strong>Artifact adapters</strong><span>{exportEntries.length} outputs</span></div>
          </div>
          <div className="rs-rail-block rs-finding-summary">
            <span className="rs-view-state success"><CheckCircle2 className="button-icon" aria-hidden="true" />Generated from current project</span>
            <h2>One source, portable outputs.</h2>
            <p>Each download is rebuilt locally from the current rubric. Clicking an adapter downloads that file only.</p>
          </div>
          {[
            ['Core', exportEntries.slice(0, 5)],
            ['Eval harnesses', exportEntries.slice(5, 9)],
            ['Datasets', exportEntries.slice(9, 10)],
            ['Review handoff', exportEntries.slice(10, 12)],
            ['CI', exportEntries.slice(12)],
          ].map(([group, entries]) => (
            <div className="rs-artifact-group" key={group as string}>
              <div className="rs-inspector-title"><span>{group as string}</span></div>
              {(entries as typeof exportEntries).map(([name, content]) => (
                <button
                  key={name}
                  className={activeArtifact === name ? 'active-export' : ''}
                  type="button"
                  onClick={() => downloadArtifact(name, content)}
                >
                  <span aria-hidden="true">›</span>{name}
                </button>
              ))}
            </div>
          ))}
          <p className="subtle">{surface === 'browser' ? 'Browser mode creates the ZIP entirely in this page.' : 'Desktop mode creates the same local ZIP without uploading content.'}</p>
        </aside>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function contentType(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'text/yaml';
  return 'text/plain';
}

async function sha256(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return 'unavailable';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

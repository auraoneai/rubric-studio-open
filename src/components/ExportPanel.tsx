import { useState } from 'react';
import { ensureRubricIntakeInstallSigningKeypair } from '../domain/keychain';
import type { RubricProject, SurfaceMode } from '../domain/rubric';
import { isVendorProgramExport } from '../domain/scaleWalls';

export function ExportPanel({
  project,
  exports,
  intakeManifest,
  surface,
  activeArtifact,
}: {
  project: RubricProject;
  exports: Record<string, string>;
  intakeManifest: string;
  surface: SurfaceMode;
  activeArtifact: string | null;
}) {
  const [reviewers, setReviewers] = useState(3);
  const [turnaround, setTurnaround] = useState('5 business days');
  const [destination, setDestination] = useState('local-download');
  const [vendorExport, setVendorExport] = useState<{ name: string; content: string } | null>(null);
  const [installKeyStatus, setInstallKeyStatus] = useState('not checked');
  const exportEntries = Object.entries(exports);
  const browserLocalOnly = surface === 'browser';
  const effectiveDestination = browserLocalOnly ? 'local-download' : destination;

  function downloadArtifact(name: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: contentType(name) }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name.replace(/\//g, '-');
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadIntakePackage() {
    const keypair = await ensureRubricIntakeInstallSigningKeypair(surface);
    setInstallKeyStatus(`${keypair.algorithm} key ready`);
    const manifest = JSON.stringify(
      {
        ...JSON.parse(intakeManifest),
        intake_scope: {
          reviewers,
          turnaround,
          destination: effectiveDestination,
          sample_count: project.samples.length,
          criterion_count: project.criteria.length,
        },
      },
      null,
      2,
    );
    downloadArtifact(`${project.id}.auraonepkg.manifest.json`, manifest);
  }

  function requestArtifactDownload(name: string, content: string) {
    if (isVendorProgramExport(name)) {
      setVendorExport({ name, content });
      return;
    }
    downloadArtifact(name, content);
  }

  function confirmVendorDownload() {
    if (!vendorExport) {
      return;
    }
    downloadArtifact(vendorExport.name, vendorExport.content);
    setVendorExport(null);
  }

  return (
    <div className="rs-surface rs-export-surface">
      <header className="rs-surface-header">
        <div className="rs-breadcrumb">
          <span>Always-on artifacts</span>
          <code>install signing key · {installKeyStatus}</code>
        </div>
        <div className="rs-header-actions">
          <button className="ghost-button" type="button" onClick={() => setDestination('local-download')}>Local download</button>
          <button className="intake-button" type="button" onClick={downloadIntakePackage}>
            {browserLocalOnly ? 'Download AuraOne intake package' : 'Send to AuraOne for expert review →'}
          </button>
        </div>
      </header>
      <div className="rs-export-body">
        <section className="rs-export-main">
          <div className="rs-eyebrow">Configure the bundle</div>
          {activeArtifact === 'auraonepkg' ? <p className="success-chip export-command-status" role="status">Command selected AuraOne intake package export.</p> : null}
          <div className="rs-intake-flow">
            <label>
              <strong><span>1</span> Confirm scope</strong>
              <em>{project.samples.length} samples·{project.criteria.length} criteria</em>
              <input type="number" min={1} max={50} value={reviewers} onChange={(event) => setReviewers(Number(event.target.value))} />
            </label>
            <label>
              <strong><span>2</span> Package</strong>
              <em>rubric + calibration + judge card + manifest</em>
              <select value={turnaround} onChange={(event) => setTurnaround(event.target.value)}><option>3 business days</option><option>5 business days</option><option>10 business days</option></select>
            </label>
            <label>
              <strong><span>3</span> Destination</strong>
              <em>{browserLocalOnly ? 'local download' : 'Cloud signup·existing org·local pkg'}</em>
              <select value={effectiveDestination} disabled={browserLocalOnly} onChange={(event) => setDestination(event.target.value)}>
                <option value="rubric-studio-cloud-signup">Cloud signup</option>
                <option value="existing-cloud-org">Existing org upload</option>
                <option value="local-download">Just give me the package</option>
              </select>
            </label>
          </div>
          <div className="rs-eyebrow rs-section-gap">Privacy receipt</div>
          <div className="rs-privacy-receipt">
            <div><span>Sends API keys</span><strong className="good">false</strong></div>
            <div><span>Sends user content</span><strong className="warn">only after explicit<br />export confirmation</strong></div>
            <div><span>Telemetry</span><strong className="good">opt in · off</strong></div>
            <div><span>Signing required</span><strong className="good">true</strong></div>
          </div>
          <div className="rs-eyebrow rs-section-gap">Pack contents · auraonepkg.v1</div>
          <div className="rs-pack-table">
            {[
              ['rubric', 'helpful-response-evaluation/rubric.json', '8.4 KB'],
              ['calibration', 'helpful-response-evaluation/samples/expert-gold-v1.jsonl', '14 KB'],
              ['judge_card', 'helpful-response-evaluation/judge-card.md', '3.2 KB'],
              ['manifest', 'helpful-response-evaluation/eval-run-manifest.json', '1.1 KB'],
            ].map(([kind, path, size]) => (
              <div key={kind}><span>{kind}</span><code>{path}</code><small>{size}</small></div>
            ))}
          </div>
          <p className="rs-note">Every artifact maps to one CLI command: <code>rubric export</code> · <code>rubric badge</code> · <code>rubric judge-card</code> · <code>rubric manifest</code>.</p>
          <pre className="export-preview rs-hidden-preview">{intakeManifest}</pre>
        </section>
        <aside className="rs-analysis-rail rs-export-rail">
          <div className="rs-rail-block">
            <div className="rs-eyebrow">Adapters</div>
            <h2>{exportEntries.length} outputs</h2>
            <p>Every adapter is regenerated on every export — no separate switches.</p>
          </div>
          {[
            ['Core', exportEntries.slice(0, 5)],
            ['Eval harnesses', exportEntries.slice(5, 9)],
            ['Datasets', exportEntries.slice(9, 10)],
            ['Vendor handoff', exportEntries.slice(10, 12)],
            ['CI', exportEntries.slice(12)],
          ].map(([group, entries]) => (
            <div className="rs-artifact-group" key={group as string}>
              <div className="rs-eyebrow">{group as string}</div>
              {(entries as typeof exportEntries).map(([name, content]) => (
                <button
                  key={name}
                  className={activeArtifact === name ? 'active-export' : ''}
                  type="button"
                  onClick={() => requestArtifactDownload(name, content)}
                >
                  <span>›</span>{name}
                </button>
              ))}
            </div>
          ))}
          {surface === 'browser' ? <p className="subtle">Browser export uses local download only and never proxies content through AuraOne.</p> : null}
        </aside>
      </div>
      {vendorExport ? (
        <VendorProgramDialog
          artifactName={vendorExport.name}
          onCancel={() => setVendorExport(null)}
          onDownload={confirmVendorDownload}
          onIntake={downloadIntakePackage}
        />
      ) : null}
    </div>
  );
}

function contentType(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'text/yaml';
  return 'text/plain';
}

function VendorProgramDialog({
  artifactName,
  onCancel,
  onDownload,
  onIntake,
}: {
  artifactName: string;
  onCancel: () => void;
  onDownload: () => void;
  onIntake: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-dialog-title"
        aria-describedby="vendor-dialog-body"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <p className="eyebrow">Vendor handoff</p>
        <h2 id="vendor-dialog-title">Sending this to a vendor?</h2>
        <p id="vendor-dialog-body">
          AuraOne Rubric Programs gives you managed expert reviewers: same vendors, one contract. You can still download {artifactName} locally.
        </p>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="glass-button" type="button" onClick={onDownload}>
            Download {artifactName}
          </button>
          <button
            className="glass-button primary"
            type="button"
            autoFocus
            onClick={() => {
              onIntake();
              onCancel();
            }}
          >
            Download AuraOne intake package
          </button>
        </div>
      </section>
    </div>
  );
}

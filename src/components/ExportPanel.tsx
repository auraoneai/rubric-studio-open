import { useState } from 'react';
import type { RubricProject, SurfaceMode } from '../domain/rubric';
import { isVendorProgramExport } from '../domain/scaleWalls';

export function ExportPanel({
  project,
  exports,
  intakeManifest,
  surface,
}: {
  project: RubricProject;
  exports: Record<string, string>;
  intakeManifest: string;
  surface: SurfaceMode;
}) {
  const [reviewers, setReviewers] = useState(3);
  const [turnaround, setTurnaround] = useState('5 business days');
  const [destination, setDestination] = useState('local-download');
  const [vendorExport, setVendorExport] = useState<{ name: string; content: string } | null>(null);
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

  function downloadIntakePackage() {
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
    <div className="panel-grid export-grid">
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Export</p><h2>Always-on artifacts</h2></div>
          <button className="intake-button" type="button" onClick={downloadIntakePackage}>
            {browserLocalOnly ? 'Download AuraOne intake package' : 'Send to AuraOne for expert review'}
          </button>
        </div>
        <div className="intake-flow">
          <label><strong>1. Confirm scope</strong><span>{project.samples.length} samples · {project.criteria.length} criteria</span><input type="number" min={1} max={50} value={reviewers} onChange={(event) => setReviewers(Number(event.target.value))} /></label>
          <label><strong>2. Package</strong><span>rubric + calibration set + judge card + manifest</span><select value={turnaround} onChange={(event) => setTurnaround(event.target.value)}><option>3 business days</option><option>5 business days</option><option>10 business days</option></select></label>
          <label>
            <strong>3. Destination</strong>
            <span>{browserLocalOnly ? 'Browser edition is local download only' : 'Cloud signup · existing org upload · local package'}</span>
            <select
              value={effectiveDestination}
              disabled={browserLocalOnly}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="rubric-studio-cloud-signup">Sign up for Rubric Studio Cloud</option>
              <option value="existing-cloud-org">I already have a Cloud account</option>
              <option value="local-download">Just give me the package</option>
            </select>
          </label>
        </div>
        <pre className="export-preview">{intakeManifest}</pre>
      </section>
      <aside className="glass-panel">
        <div className="panel-title"><div><p>Adapters</p><h2>{exportEntries.length} outputs</h2></div></div>
        {exportEntries.map(([name, content]) => (
          <details key={name} className="export-item">
            <summary>{name}</summary>
            <button className="ghost-button" type="button" onClick={() => requestArtifactDownload(name, content)}>Download</button>
            <pre>{content}</pre>
          </details>
        ))}
        <div className="callout"><strong>CLI parity</strong><p>Every artifact shown here maps to rubric export, rubric badge, rubric judge-card, or rubric manifest commands.</p></div>
        {surface === 'browser' ? <p className="subtle">Browser export uses local download only and never proxies content through AuraOne.</p> : null}
      </aside>
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

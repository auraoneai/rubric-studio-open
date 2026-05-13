import { useState } from 'react';
import type { RubricProject, SurfaceMode } from '../domain/rubric';
import { validateProject } from '../domain/validation';

export function BrowserProjectControls({
  project,
  surface,
  onImport,
}: {
  project: RubricProject;
  surface: SurfaceMode;
  onImport: (project: RubricProject) => void;
}) {
  const [error, setError] = useState('');

  function exportProject() {
    const payload = JSON.stringify(
      {
        schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
        exportedAt: new Date().toISOString(),
        project,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.id}.rubric-project.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { project?: RubricProject };
      if (!parsed.project?.id || !Array.isArray(parsed.project.criteria)) {
        setError('Invalid project bundle. Choose a Rubric Studio Open JSON export with a project and criteria.');
        return;
      }
      const issues = validateProject(parsed.project);
      if (issues.some((issue) => issue.severity === 'error')) {
        setError(`Project bundle has ${issues.filter((issue) => issue.severity === 'error').length} schema errors. Fix the bundle and import again.`);
        return;
      }
      setError('');
      onImport(parsed.project);
    } catch {
      setError('Project import failed. Check that the file is valid JSON and try again.');
    }
  }

  return (
    <div className="browser-controls" aria-label="Browser project import and export">
      <button className="ghost-button" type="button" onClick={exportProject}>
        Export bundle
      </button>
      <label className="file-button">
        <span>Import bundle</span>
        <input
          type="file"
          accept="application/json,.json,.rubric-project.json"
          onChange={(event) => {
            void importProject(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      {error ? <span className="inline-error" role="alert">{error}</span> : null}
      {surface === 'browser' ? <small>Local browser storage only</small> : null}
    </div>
  );
}

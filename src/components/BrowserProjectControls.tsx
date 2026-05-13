import type { RubricProject, SurfaceMode } from '../domain/rubric';

export function BrowserProjectControls({
  project,
  surface,
  onImport,
}: {
  project: RubricProject;
  surface: SurfaceMode;
  onImport: (project: RubricProject) => void;
}) {
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
    const text = await file.text();
    const parsed = JSON.parse(text) as { project?: RubricProject };
    if (parsed.project?.id && Array.isArray(parsed.project.criteria)) {
      onImport(parsed.project);
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
      {surface === 'browser' ? <small>Local browser storage only</small> : null}
    </div>
  );
}

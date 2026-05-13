import { useState } from 'react';
import { browserFolderArtifacts, projectFromBrowserFolder } from '../domain/browserFolder';
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
  const [status, setStatus] = useState('');

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

  async function exportFolder() {
    if (!supportsDirectoryPicker('readwrite')) {
      setError('Browser folder export requires a File System Access capable browser. Use Export bundle as a fallback.');
      return;
    }
    try {
      const directory = await window.showDirectoryPicker?.({ mode: 'readwrite' });
      if (!directory) {
        setError('Browser folder export requires a File System Access capable browser. Use Export bundle as a fallback.');
        return;
      }
      await Promise.all(browserFolderArtifacts(project).map((artifact) => writeArtifact(directory, artifact.path, artifact.content)));
      setError('');
      setStatus(`Exported ${browserFolderArtifacts(project).length} files to the selected browser folder.`);
    } catch (exportError) {
      if (isAbortError(exportError)) {
        setStatus('Folder export canceled.');
      } else {
        setError(exportError instanceof Error ? exportError.message : 'Browser folder export failed.');
      }
    }
  }

  async function importFolder() {
    if (!supportsDirectoryPicker('read')) {
      setError('Browser folder import requires a File System Access capable browser. Use Import bundle as a fallback.');
      return;
    }
    try {
      const directory = await window.showDirectoryPicker?.({ mode: 'read' });
      if (!directory) {
        setError('Browser folder import requires a File System Access capable browser. Use Import bundle as a fallback.');
        return;
      }
      const files = await readProjectFiles(directory);
      const projectFromFolder = projectFromBrowserFolder(files);
      if (!projectFromFolder?.id || !Array.isArray(projectFromFolder.criteria)) {
        setError('Browser folder is missing project-bundle.json or rubric.json with criteria.');
        return;
      }
      const issues = validateProject(projectFromFolder);
      if (issues.some((issue) => issue.severity === 'error')) {
        setError(`Browser folder has ${issues.filter((issue) => issue.severity === 'error').length} schema errors. Fix the folder and import again.`);
        return;
      }
      setError('');
      setStatus(`Imported ${projectFromFolder.name} from browser folder.`);
      onImport(projectFromFolder);
    } catch (importError) {
      if (isAbortError(importError)) {
        setStatus('Folder import canceled.');
      } else {
        setError(importError instanceof Error ? importError.message : 'Browser folder import failed.');
      }
    }
  }

  return (
    <div className="browser-controls" aria-label="Browser project import and export">
      <button className="ghost-button" type="button" onClick={exportProject}>
        Export bundle
      </button>
      {surface === 'browser' ? (
        <button className="ghost-button" type="button" onClick={() => void exportFolder()}>
          Export folder
        </button>
      ) : null}
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
      {surface === 'browser' ? (
        <button className="ghost-button" type="button" onClick={() => void importFolder()}>
          Import folder
        </button>
      ) : null}
      {error ? <span className="inline-error" role="alert">{error}</span> : null}
      {status ? <span className="success-chip" role="status">{status}</span> : null}
      {surface === 'browser' ? <small>Local browser storage only</small> : null}
    </div>
  );
}

async function writeArtifact(directory: FileSystemDirectoryHandle, path: string, content: string) {
  const segments = path.split('/');
  const filename = segments.pop();
  if (!filename) {
    return;
  }
  let target = directory;
  for (const segment of segments) {
    target = await target.getDirectoryHandle(segment, { create: true });
  }
  const file = await target.getFileHandle(filename, { create: true });
  const writer = await file.createWritable();
  await writer.write(content);
  await writer.close();
}

async function readProjectFiles(directory: FileSystemDirectoryHandle): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await readOptionalFile(directory, files, 'project-bundle.json');
  await readOptionalFile(directory, files, 'rubric.json');
  return files;
}

async function readOptionalFile(directory: FileSystemDirectoryHandle, files: Record<string, string>, path: string) {
  try {
    const file = await directory.getFileHandle(path);
    files[path] = await (await file.getFile()).text();
  } catch {
    // Missing optional import files are handled by the caller's validation message.
  }
}

function supportsDirectoryPicker(mode: FileSystemPermissionMode): boolean {
  return typeof window.showDirectoryPicker === 'function' && (mode === 'read' || mode === 'readwrite');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface FileSystemDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

type FileSystemPermissionMode = 'read' | 'readwrite';

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: FileSystemPermissionMode }) => Promise<FileSystemDirectoryHandle>;
  }
}

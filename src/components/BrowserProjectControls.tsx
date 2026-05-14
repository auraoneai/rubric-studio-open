import { useState } from 'react';
import { browserFolderArtifacts, projectFromBrowserFolder } from '../domain/browserFolder';
import type { RubricProject, SurfaceMode, ValidationIssue } from '../domain/rubric';
import { validateProject } from '../domain/validation';

interface ImportErrorState {
  message: string;
  recovery: boolean;
}

export function BrowserProjectControls({
  project,
  surface,
  onImport,
}: {
  project: RubricProject;
  surface: SurfaceMode;
  onImport: (project: RubricProject) => void;
}) {
  const [error, setError] = useState<ImportErrorState | null>(null);
  const [status, setStatus] = useState('');

  function exportProject(filename = `${project.id}.rubric-project.json`) {
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
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(file: File | undefined) {
    if (!file) {
      return;
    }
    const fileName = file.name || 'project-bundle.json';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { project?: RubricProject };
      if (!parsed.project?.id || !Array.isArray(parsed.project.criteria)) {
        setError({
          message: `Invalid project bundle. Choose a Rubric Studio Open JSON export with a project and criteria. First check ${fileName}: line ${lineForText(text, '"project"')}.`,
          recovery: true,
        });
        return;
      }
      const issues = validateProject(parsed.project);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        setError({
          message: `Project bundle has ${errors.length} schema errors. Fix the bundle and import again. ${schemaPointer(errors[0], text, fileName)}`,
          recovery: true,
        });
        return;
      }
      setError(null);
      onImport(parsed.project);
    } catch (importError) {
      setError({
        message: `Project import failed. Check that the file is valid JSON and try again. ${jsonParsePointer(importError, fileName)}`,
        recovery: true,
      });
    }
  }

  async function exportFolder() {
    if (!supportsDirectoryPicker('readwrite')) {
      setError({
        message: 'Browser folder export requires a File System Access capable browser. Use Export bundle as a fallback.',
        recovery: false,
      });
      return;
    }
    try {
      const directory = await window.showDirectoryPicker?.({ mode: 'readwrite' });
      if (!directory) {
        setError({
          message: 'Browser folder export requires a File System Access capable browser. Use Export bundle as a fallback.',
          recovery: false,
        });
        return;
      }
      await Promise.all(browserFolderArtifacts(project).map((artifact) => writeArtifact(directory, artifact.path, artifact.content)));
      setError(null);
      setStatus(`Exported ${browserFolderArtifacts(project).length} files to the selected browser folder.`);
    } catch (exportError) {
      if (isAbortError(exportError)) {
        setStatus('Folder export canceled.');
      } else {
        setError({
          message: exportError instanceof Error ? exportError.message : 'Browser folder export failed.',
          recovery: false,
        });
      }
    }
  }

  async function importFolder() {
    if (!supportsDirectoryPicker('read')) {
      setError({
        message: 'Browser folder import requires a File System Access capable browser. Use Import bundle as a fallback.',
        recovery: false,
      });
      return;
    }
    try {
      const directory = await window.showDirectoryPicker?.({ mode: 'read' });
      if (!directory) {
        setError({
          message: 'Browser folder import requires a File System Access capable browser. Use Import bundle as a fallback.',
          recovery: false,
        });
        return;
      }
      const files = await readProjectFiles(directory);
      const projectFromFolder = projectFromBrowserFolder(files);
      if (!projectFromFolder?.id || !Array.isArray(projectFromFolder.criteria)) {
        setError({
          message: 'Browser folder is missing project-bundle.json or rubric.json with criteria. First check project-bundle.json: line 1.',
          recovery: true,
        });
        return;
      }
      const issues = validateProject(projectFromFolder);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        const sourcePath = files['project-bundle.json'] ? 'project-bundle.json' : 'rubric.json';
        const sourceText = files[sourcePath] ?? '';
        setError({
          message: `Browser folder has ${errors.length} schema errors. Fix the folder and import again. ${schemaPointer(errors[0], sourceText, sourcePath)}`,
          recovery: true,
        });
        return;
      }
      setError(null);
      setStatus(`Imported ${projectFromFolder.name} from browser folder.`);
      onImport(projectFromFolder);
    } catch (importError) {
      if (isAbortError(importError)) {
        setStatus('Folder import canceled.');
      } else {
        setError({
          message: importError instanceof Error ? importError.message : 'Browser folder import failed.',
          recovery: true,
        });
      }
    }
  }

  function downloadRepairTemplate() {
    exportProject(`${project.id}.repair-template.rubric-project.json`);
  }

  return (
    <div className="browser-controls" aria-label="Browser project import and export">
      <button className="ghost-button" type="button" onClick={() => exportProject()}>
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
      {error ? (
        <span className="inline-error import-error" role="alert">
          {error.message}
          {error.recovery ? (
            <button className="ghost-button" type="button" onClick={downloadRepairTemplate}>
              Download valid template
            </button>
          ) : null}
        </span>
      ) : null}
      {status ? <span className="success-chip" role="status">{status}</span> : null}
      {surface === 'browser' ? <small>Local browser storage only</small> : null}
    </div>
  );
}

function schemaPointer(issue: ValidationIssue, sourceText: string, sourcePath: string): string {
  const line = lineForIssue(sourceText, issue);
  const criterion = issue.criterionId !== undefined ? ` on criterion ${issue.criterionId || '<missing id>'}` : '';
  const quickFix = issue.quickFix ? ` Quick action: ${issue.quickFix}.` : ' Quick action: compare against a valid template.';
  return `First error at ${sourcePath}: line ${line}, field ${issue.field}${criterion}: ${issue.message}${quickFix}`;
}

function lineForIssue(sourceText: string, issue: ValidationIssue): number {
  if (issue.criterionId) {
    const criterionLine = lineForText(sourceText, `"id": "${issue.criterionId}"`);
    if (criterionLine > 1) {
      return criterionLine;
    }
  }
  return lineForText(sourceText, `"${issue.field}"`);
}

function lineForText(sourceText: string, needle: string): number {
  const index = sourceText.indexOf(needle);
  if (index < 0) {
    return 1;
  }
  return sourceText.slice(0, index).split('\n').length;
}

function jsonParsePointer(error: unknown, sourcePath: string): string {
  if (!(error instanceof SyntaxError) || !('message' in error)) {
    return `First check ${sourcePath}: line 1.`;
  }
  const match = String(error.message).match(/position (\d+)/);
  if (!match) {
    return `First check ${sourcePath}: line 1.`;
  }
  const position = Number(match[1]);
  if (!Number.isFinite(position)) {
    return `First check ${sourcePath}: line 1.`;
  }
  return `Parser stopped in ${sourcePath} near character ${position}.`;
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

import type { RubricProject, SurfaceMode } from './rubric';

export type DiagnosticSeverity = 'ok' | 'blocked' | 'action';

export interface DiagnosticRow {
  id: string;
  label: string;
  status: DiagnosticSeverity;
  message: string;
  action: string;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function runOperationalDiagnostics(options: {
  surface: SurfaceMode;
  project: RubricProject;
  openedProjectPath: string | null;
}): Promise<DiagnosticRow[]> {
  const [storage, checksums, projectBackend, folderAccess] = await Promise.all([
    checkLocalStorage(),
    checkWebCrypto(),
    checkProjectBackend(options),
    checkFolderAccess(options.surface),
  ]);
  return [projectBackend, storage, checksums, folderAccess];
}

async function checkLocalStorage(): Promise<DiagnosticRow> {
  const key = `rso:diagnostic:${Date.now()}`;
  const value = `roundtrip-${Math.random().toString(16).slice(2)}`;
  try {
    localStorage.setItem(key, value);
    const verified = localStorage.getItem(key) === value;
    localStorage.removeItem(key);
    if (!verified) throw new Error('read-back mismatch');
    return {
      id: 'local-storage',
      label: 'Local storage',
      status: 'ok',
      message: 'Write, read-back, and cleanup completed successfully.',
      action: 'No action required.',
    };
  } catch (error) {
    return {
      id: 'local-storage',
      label: 'Local storage',
      status: 'blocked',
      message: error instanceof Error ? error.message : 'Local storage roundtrip failed.',
      action: 'Allow site storage or export the project bundle before continuing.',
    };
  }
}

async function checkWebCrypto(): Promise<DiagnosticRow> {
  try {
    if (!globalThis.crypto?.subtle) throw new Error('WebCrypto SubtleCrypto is unavailable.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('rubric-studio-open'));
    if (digest.byteLength !== 32) throw new Error('SHA-256 returned an unexpected digest length.');
    return {
      id: 'checksums',
      label: 'Package checksums',
      status: 'ok',
      message: 'WebCrypto SHA-256 completed a real local digest.',
      action: 'No action required.',
    };
  } catch (error) {
    return {
      id: 'checksums',
      label: 'Package checksums',
      status: 'blocked',
      message: error instanceof Error ? error.message : 'SHA-256 check failed.',
      action: 'Use a current browser or desktop WebView before creating an evidence ZIP.',
    };
  }
}

async function checkProjectBackend(options: {
  surface: SurfaceMode;
  project: RubricProject;
  openedProjectPath: string | null;
}): Promise<DiagnosticRow> {
  if (options.surface === 'browser') {
    try {
      const stored = localStorage.getItem('rso:project');
      const parsed = stored ? JSON.parse(stored) as Partial<RubricProject> : null;
      const matches = parsed?.id === options.project.id;
      return {
        id: 'project-backend',
        label: 'Project persistence',
        status: matches ? 'ok' : 'action',
        message: matches
          ? 'The current project is present in browser-local storage.'
          : 'The current project has not completed a verified browser-local save yet.',
        action: matches ? 'Export a bundle for a portable backup.' : 'Wait for autosave or use Save current project.',
      };
    } catch (error) {
      return {
        id: 'project-backend',
        label: 'Project persistence',
        status: 'blocked',
        message: error instanceof Error ? error.message : 'Stored project JSON could not be read.',
        action: 'Export a valid bundle and clear the corrupt local project entry.',
      };
    }
  }

  if (!options.openedProjectPath) {
    return {
      id: 'project-backend',
      label: 'Project persistence',
      status: 'action',
      message: 'No native project folder is open; saves use the app-local cache.',
      action: 'Open or create a project folder for atomic native file saves.',
    };
  }
  if (window.__TAURI_INTERNALS__ === undefined) {
    return {
      id: 'project-backend',
      label: 'Project persistence',
      status: 'blocked',
      message: 'The desktop surface is running without a Tauri native bridge.',
      action: 'Open the installed desktop application or switch to the browser surface.',
    };
  }
  try {
    const invoke = await loadTauriInvoke();
    if (!invoke) throw new Error('Tauri invoke API is unavailable.');
    const opened = await invoke<{ path: string; project: { id: string } }>('open_rubric_project_folder', {
      path: options.openedProjectPath,
    });
    if (opened.project.id !== options.project.id) {
      throw new Error('Opened folder project id does not match the editor project.');
    }
    return {
      id: 'project-backend',
      label: 'Project persistence',
      status: 'ok',
      message: `Native project folder passed a real read and identity check at ${opened.path}.`,
      action: 'No action required.',
    };
  } catch (error) {
    return {
      id: 'project-backend',
      label: 'Project persistence',
      status: 'blocked',
      message: error instanceof Error ? error.message : 'Native project preflight failed.',
      action: 'Reopen the project folder and resolve the reported manifest or path error.',
    };
  }
}

async function checkFolderAccess(surface: SurfaceMode): Promise<DiagnosticRow> {
  if (surface === 'desktop') {
    return {
      id: 'folder-access',
      label: 'Folder controls',
      status: window.__TAURI_INTERNALS__ === undefined ? 'action' : 'ok',
      message: window.__TAURI_INTERNALS__ === undefined
        ? 'Tauri folder controls are unavailable in this browser-rendered desktop preview.'
        : 'Native folder picker and drag/drop bridges are registered.',
      action: window.__TAURI_INTERNALS__ === undefined ? 'Use the installed app for native folder access.' : 'No action required.',
    };
  }
  const supported = typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  return {
    id: 'folder-access',
    label: 'Browser folder access',
    status: supported ? 'ok' : 'action',
    message: supported
      ? 'File System Access folder import/export is available.'
      : 'This browser does not expose File System Access folder handles.',
    action: supported ? 'No action required.' : 'Use visible bundle import/export controls instead.',
  };
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as TauriInvoke;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

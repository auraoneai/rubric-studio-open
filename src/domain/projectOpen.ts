import { openRubricProjectFolder, type OpenedRubricProject } from './deepLink';
import type { RubricProject } from './rubric';

export interface RecentProject {
  name: string;
  path: string;
  lastOpenedAt: string;
}

const recentProjectsKey = 'rso:recent-projects';

type DialogOpen = (options: {
  directory: boolean;
  multiple: boolean;
  title: string;
}) => Promise<string | string[] | null>;

type DragDropEvent = {
  payload: {
    type: string;
    paths?: string[];
  };
};

type Webview = {
  onDragDropEvent(handler: (event: DragDropEvent) => void): Promise<() => void>;
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function pickRubricProjectFolder(): Promise<string | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const open = await loadDialogOpen();
  if (!open) {
    throw new Error('Desktop folder picker is unavailable.');
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Open Rubric Studio project folder',
  });
  return typeof selected === 'string' ? selected : null;
}

export async function createRubricProjectFromTemplate(name: string): Promise<OpenedRubricProject | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const open = await loadDialogOpen();
  if (!open) {
    throw new Error('Desktop template picker is unavailable.');
  }
  const parent = await open({
    directory: true,
    multiple: false,
    title: 'Choose parent folder for the starter rubric project',
  });
  if (typeof parent !== 'string') {
    return null;
  }
  const invoke = await loadTauriInvoke();
  if (!invoke) {
    throw new Error('Desktop template creator is unavailable.');
  }
  const opened = await invoke<OpenedRubricProject>('create_rubric_project_from_template', {
    parent,
    name,
  });
  rememberProject(opened.project.name, opened.path);
  return opened;
}

export async function openRubricProjectPath(path: string): Promise<OpenedRubricProject> {
  const opened = await openRubricProjectFolder(path);
  rememberProject(opened.project.name, opened.path);
  return opened;
}

export async function saveRubricProjectPath(path: string, project: RubricProject): Promise<OpenedRubricProject | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const invoke = await loadTauriInvoke();
  if (!invoke) {
    throw new Error('Desktop project autosave bridge is unavailable.');
  }
  const opened = await invoke<OpenedRubricProject>('save_rubric_project_folder', {
    path,
    project,
  });
  rememberProject(opened.project.name, opened.path);
  return opened;
}

export async function revealProjectPath(path: string, mode: 'containing' | 'reveal'): Promise<string> {
  if (!isDesktopShell()) {
    throw new Error('Browser edition cannot open the system file manager.');
  }
  const invoke = await loadTauriInvoke();
  if (!invoke) {
    throw new Error('Desktop file-manager bridge is unavailable.');
  }
  return invoke<string>('reveal_project_path', {
    path,
    reveal: mode === 'reveal',
  });
}

export async function connectProjectDrop(
  onPath: (path: string) => void | Promise<void>,
  onError: (message: string) => void,
): Promise<() => void> {
  if (!isDesktopShell()) {
    return () => undefined;
  }
  try {
    const webview = await loadCurrentWebview();
    if (!webview) {
      return () => undefined;
    }
    return webview.onDragDropEvent((event) => {
      const path = event.payload.type === 'drop' ? event.payload.paths?.[0] : undefined;
      if (path) {
        void onPath(path);
      }
    });
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Project drag/drop listener could not start.');
    return () => undefined;
  }
}

export function readRecentProjects(): RecentProject[] {
  try {
    const stored = localStorage.getItem(recentProjectsKey);
    return stored ? sanitizeRecentProjects(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

export function rememberProject(name: string, path: string, now = new Date()): RecentProject[] {
  const next = [
    { name, path, lastOpenedAt: now.toISOString() },
    ...readRecentProjects().filter((project) => project.path !== path),
  ].slice(0, 8);
  localStorage.setItem(recentProjectsKey, JSON.stringify(next));
  return next;
}

export function clearRecentProjects(): void {
  localStorage.removeItem(recentProjectsKey);
}

export function defaultTemplateProjectName(): string {
  return 'Helpful Response Evaluation';
}

export function isDesktopShell(): boolean {
  return window.__TAURI_INTERNALS__ !== undefined;
}

async function loadDialogOpen(): Promise<DialogOpen | null> {
  try {
    const api = await import('@tauri-apps/plugin-dialog');
    return api.open as DialogOpen;
  } catch {
    return null;
  }
}

async function loadCurrentWebview(): Promise<Webview | null> {
  try {
    const api = await import('@tauri-apps/api/webview');
    return api.getCurrentWebview() as Webview;
  } catch {
    return null;
  }
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as TauriInvoke;
  } catch {
    return null;
  }
}

function sanitizeRecentProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RecentProject =>
      typeof item?.name === 'string' &&
      typeof item?.path === 'string' &&
      typeof item?.lastOpenedAt === 'string',
    )
    .slice(0, 8);
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

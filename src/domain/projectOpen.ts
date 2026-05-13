import { openRubricProjectFolder, type OpenedRubricProject } from './deepLink';

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

export async function openRubricProjectPath(path: string): Promise<OpenedRubricProject> {
  const opened = await openRubricProjectFolder(path);
  rememberProject(opened.project.name, opened.path);
  return opened;
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

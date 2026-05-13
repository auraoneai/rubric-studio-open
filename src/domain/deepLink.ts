import type { RubricProject } from './rubric';

export interface DeepLinkPayload {
  flagship: string;
  action: string;
  params: Record<string, string>;
  installUrl?: string;
}

export interface OpenedRubricProject {
  project: RubricProject;
  path: string;
  openedAt: string;
  source: 'desktop-folder';
}

export type DeepLinkTarget =
  | { kind: 'install'; installUrl: string; flagship: string }
  | { kind: 'open-project'; path: string; flagship: 'rubric-studio' | 'rubric-studio-open' }
  | { kind: 'unsupported-action'; action: string; flagship: string }
  | { kind: 'ignored-flagship'; flagship: string };

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriListen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export function classifyDeepLink(payload: DeepLinkPayload): DeepLinkTarget {
  if (payload.installUrl) {
    return { kind: 'install', installUrl: payload.installUrl, flagship: payload.flagship };
  }
  if (!isRubricFlagship(payload.flagship)) {
    return { kind: 'ignored-flagship', flagship: payload.flagship };
  }
  if (payload.action === 'open-project' && payload.params.path) {
    return {
      kind: 'open-project',
      path: payload.params.path,
      flagship: payload.flagship,
    };
  }
  return { kind: 'unsupported-action', action: payload.action, flagship: payload.flagship };
}

export async function openRubricProjectFolder(path: string): Promise<OpenedRubricProject> {
  const invoke = await loadTauriInvoke();
  if (!invoke || window.__TAURI_INTERNALS__ === undefined) {
    throw new Error('Project folders can be opened only inside the Tauri desktop shell.');
  }
  return invoke<OpenedRubricProject>('open_rubric_project_folder', { path });
}

export async function connectDesktopDeepLinks(
  onPayload: (payload: DeepLinkPayload) => void | Promise<void>,
  onError: (message: string) => void,
): Promise<() => void> {
  if (window.__TAURI_INTERNALS__ === undefined) {
    return () => undefined;
  }
  try {
    const listen = await loadTauriListen();
    if (!listen) {
      return () => undefined;
    }
    return listen<DeepLinkPayload>('auraone://deep-link', (event) => {
      void onPayload(event.payload);
    });
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Deep-link listener could not start.');
    return () => undefined;
  }
}

function isRubricFlagship(flagship: string): flagship is 'rubric-studio' | 'rubric-studio-open' {
  return flagship === 'rubric-studio' || flagship === 'rubric-studio-open';
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as TauriInvoke;
  } catch {
    return null;
  }
}

async function loadTauriListen(): Promise<TauriListen | null> {
  try {
    const api = await import('@tauri-apps/api/event');
    return api.listen as TauriListen;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

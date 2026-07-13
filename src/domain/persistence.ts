import { isDesktopShell, saveRubricProjectPath } from './projectOpen';
import type { RubricProject, SurfaceMode } from './rubric';

export type PersistenceBackend = 'native-folder' | 'browser-storage' | 'desktop-local-cache';

export interface ProjectPersistenceReceipt {
  backend: PersistenceBackend;
  savedAt: string;
  message: string;
  path: string | null;
  filesWritten: number;
  filesRemoved: number;
  atomic: boolean;
}

export async function persistProject(
  project: RubricProject,
  surface: SurfaceMode,
  openedProjectPath: string | null,
): Promise<ProjectPersistenceReceipt> {
  if (surface === 'desktop' && openedProjectPath && isDesktopShell()) {
    const receipt = await saveRubricProjectPath(openedProjectPath, project);
    return {
      backend: 'native-folder',
      savedAt: unixTimestampToIso(receipt.savedAt),
      message: `Saved ${receipt.filesWritten} project files atomically`,
      path: receipt.path,
      filesWritten: receipt.filesWritten,
      filesRemoved: receipt.filesRemoved,
      atomic: receipt.atomic,
    };
  }

  const serialized = JSON.stringify(project);
  localStorage.setItem('rso:project', serialized);
  if (localStorage.getItem('rso:project') !== serialized) {
    throw new Error('Local project storage did not verify after write.');
  }
  const browserStorage = surface === 'browser';
  return {
    backend: browserStorage ? 'browser-storage' : 'desktop-local-cache',
    savedAt: new Date().toISOString(),
    message: browserStorage
      ? 'Saved in this browser; export a bundle for a portable copy'
      : 'Saved to the app-local cache; open or create a folder for project files',
    path: null,
    filesWritten: 1,
    filesRemoved: 0,
    atomic: false,
  };
}

export function persistenceBackendLabel(
  surface: SurfaceMode,
  openedProjectPath: string | null,
): string {
  if (surface === 'desktop' && openedProjectPath && isDesktopShell()) {
    return 'opened project folder';
  }
  return surface === 'browser' ? 'this browser' : 'app-local cache';
}

function unixTimestampToIso(value: string): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

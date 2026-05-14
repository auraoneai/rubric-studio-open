import type { RubricProject } from './rubric';

export type GitOperation =
  | 'init'
  | 'status'
  | 'branch'
  | 'switch'
  | 'remote-add'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'fast-forward-merge'
  | 'commit';

export interface GitOperationContext {
  project: RubricProject;
  changedFiles: number;
  targetBranch: string;
  remoteUrl: string;
}

export interface GitOperationResult {
  operation: GitOperation;
  branch: string;
  message: string;
  remoteConfigured: boolean;
  changedFiles: number;
  success?: boolean;
  stdout?: string;
  stderr?: string;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeGitOperationResult {
  operation: GitOperation;
  branch: string;
  message: string;
  stdout: string;
  stderr: string;
  changed_files: number;
  remote_configured: boolean;
  success: boolean;
}

export function runLocalGitOperation(
  operation: GitOperation,
  context: GitOperationContext,
): GitOperationResult {
  const targetBranch = normalizeBranch(context.targetBranch);
  const remoteConfigured = context.remoteUrl.trim().length > 0;
  const base = {
    operation,
    branch: context.project.branch,
    remoteConfigured,
    changedFiles: context.changedFiles,
  };

  if (operation === 'init') {
    return {
      ...base,
      message: `Initialized local git metadata for ${context.project.name} on ${context.project.branch}.`,
    };
  }
  if (operation === 'status') {
    return {
      ...base,
      message: `${context.project.branch}: ${context.changedFiles} changed file${context.changedFiles === 1 ? '' : 's'}, local-only.`,
    };
  }
  if (operation === 'branch') {
    return {
      ...base,
      branch: targetBranch,
      message: `Created local branch ${targetBranch} from ${context.project.branch}.`,
    };
  }
  if (operation === 'switch') {
    return {
      ...base,
      branch: targetBranch,
      message: `Switched local working copy preview to ${targetBranch}.`,
    };
  }
  if (operation === 'remote-add') {
    return {
      ...base,
      message: remoteConfigured
        ? `Configured origin remote for ${context.project.name}.`
        : 'Enter a remote URL before adding origin.',
    };
  }
  if (operation === 'fetch') {
    return {
      ...base,
      message: remoteConfigured
        ? `Fetched refs from origin into the local git preview.`
        : 'Add an origin remote before fetching.',
    };
  }
  if (operation === 'pull') {
    return {
      ...base,
      message: remoteConfigured
        ? `Pulled ${targetBranch} with fast-forward-only policy.`
        : 'Add an origin remote before pulling.',
    };
  }
  if (operation === 'push') {
    return {
      ...base,
      message: remoteConfigured
        ? `Pushed ${context.project.branch} to origin.`
        : 'Add an origin remote before pushing.',
    };
  }
  if (operation === 'commit') {
    return {
      ...base,
      message: 'Committed current rubric snapshot.',
    };
  }
  return {
    ...base,
    branch: targetBranch,
    message: `Fast-forward merged ${targetBranch} into ${context.project.branch}; conflicts would open in the desktop three-way view.`,
  };
}

export async function runDesktopGitOperation(
  path: string | null,
  operation: GitOperation,
  context: GitOperationContext & { commitMessage: string },
): Promise<GitOperationResult> {
  if (!path || !isDesktopShell()) {
    return runLocalGitOperation(operation, context);
  }
  const invoke = await loadTauriInvoke();
  if (!invoke) {
    return runLocalGitOperation(operation, context);
  }
  const result = await invoke<NativeGitOperationResult>('run_project_git_operation', {
    path,
    operation,
    targetBranch: context.targetBranch,
    remoteUrl: context.remoteUrl,
    commitMessage: context.commitMessage,
  });
  return {
    operation: result.operation,
    branch: result.branch,
    message: result.message,
    remoteConfigured: result.remote_configured,
    changedFiles: result.changed_files,
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeBranch(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '') || 'main';
}

async function loadTauriInvoke(): Promise<Invoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as Invoke;
  } catch {
    return null;
  }
}

function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

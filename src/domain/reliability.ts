import type { SurfaceMode } from './rubric';

export interface ReliabilityStatus {
  crash: {
    enabled: boolean;
    provider: 'sentry';
    project: 'rubric-studio-open';
    default_off: boolean;
    scrub_paths: boolean;
    scrub_hostnames: boolean;
    scrub_api_keys: boolean;
    sends_user_authored_content: boolean;
  };
  updater: {
    active: boolean;
    channel: 'stable' | 'beta';
    endpoints: [string, string];
    pubkey: string;
    signature_required: boolean;
    kill_switch_supported: boolean;
  };
}

export type UpdateCheckResult =
  | {
      status: 'unavailable';
      reason: string;
      checked_at: string;
    }
  | {
      status: 'current';
      checked_at: string;
    }
  | {
      status: 'available';
      version: string;
      body: string;
      date: string | null;
      checked_at: string;
    }
  | {
      status: 'error';
      reason: string;
      checked_at: string;
    };

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type DesktopUpdate = {
  version: string;
  body?: string | null;
  date?: string | null;
};
type DesktopUpdateChecker = () => Promise<DesktopUpdate | null>;

export async function getReliabilityStatus(
  surface: SurfaceMode,
  crashEnabled: boolean,
  updateChannel: 'stable' | 'beta',
): Promise<ReliabilityStatus> {
  if (surface === 'desktop' && typeof window !== 'undefined') {
    const invoke = await tauriInvoke();
    if (invoke) {
      return invoke<ReliabilityStatus>('platform_reliability_status', {
        crashEnabled,
        updateChannel,
      });
    }
  }
  return fallbackReliabilityStatus(crashEnabled, updateChannel);
}

export function fallbackReliabilityStatus(
  crashEnabled: boolean,
  updateChannel: 'stable' | 'beta',
): ReliabilityStatus {
  return {
    crash: {
      enabled: crashEnabled,
      provider: 'sentry',
      project: 'rubric-studio-open',
      default_off: true,
      scrub_paths: true,
      scrub_hostnames: true,
      scrub_api_keys: true,
      sends_user_authored_content: false,
    },
    updater: {
      active: true,
      channel: updateChannel,
      endpoints: [
        'https://updates.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}',
        'https://updates2.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}',
      ],
      pubkey: 'DAKD/Nqj4KoXZpXv9li/zVQv+2LhThXE5J9tx0Wl1B8=',
      signature_required: true,
      kill_switch_supported: true,
    },
  };
}

export async function checkForPlatformUpdate(
  surface: SurfaceMode,
  checker?: DesktopUpdateChecker,
): Promise<UpdateCheckResult> {
  const checked_at = new Date().toISOString();
  if (surface !== 'desktop') {
    return {
      status: 'unavailable',
      reason: 'Browser edition cannot install signed desktop updates.',
      checked_at,
    };
  }
  try {
    const update = await (checker ?? defaultDesktopUpdateChecker)();
    if (!update) {
      return { status: 'current', checked_at };
    }
    return {
      status: 'available',
      version: update.version,
      body: update.body ?? '',
      date: update.date ?? null,
      checked_at,
    };
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : 'Desktop updater check failed.',
      checked_at,
    };
  }
}

async function defaultDesktopUpdateChecker(): Promise<DesktopUpdate | null> {
  const updater = await import('@tauri-apps/plugin-updater');
  return updater.check();
}

async function tauriInvoke(): Promise<Invoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as Invoke;
  } catch {
    return null;
  }
}

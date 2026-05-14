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
      mandatory: boolean;
      signed_by: string;
      signing_docs_url: string;
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
  mandatory?: boolean;
  signedBy?: string | null;
  signingDocsUrl?: string | null;
};
type DesktopUpdateChecker = () => Promise<DesktopUpdate | null>;

declare global {
  interface Window {
    __RUBRIC_STUDIO_TEST_UPDATE__?: DesktopUpdate | null | (() => DesktopUpdate | null | Promise<DesktopUpdate | null>);
  }
}

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
      pubkey: '<PLATFORM_UPDATE_PUBKEY>',
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
    return availableUpdateResult(update, checked_at);
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : 'Desktop updater check failed.',
      checked_at,
    };
  }
}

function availableUpdateResult(update: DesktopUpdate, checked_at: string): UpdateCheckResult {
  const body = update.body ?? '';
  return {
    status: 'available',
    version: update.version,
    body,
    date: update.date ?? null,
    mandatory: update.mandatory === true || /\[mandatory\]/i.test(body),
    signed_by: update.signedBy ?? 'AuraOne Open Studio release key',
    signing_docs_url: update.signingDocsUrl ?? 'https://github.com/auraoneai/rubric-studio-open/blob/main/docs/security.md',
    checked_at,
  };
}

async function defaultDesktopUpdateChecker(): Promise<DesktopUpdate | null> {
  if (typeof window !== 'undefined' && '__RUBRIC_STUDIO_TEST_UPDATE__' in window) {
    const fixture = window.__RUBRIC_STUDIO_TEST_UPDATE__;
    return typeof fixture === 'function' ? fixture() : fixture ?? null;
  }
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

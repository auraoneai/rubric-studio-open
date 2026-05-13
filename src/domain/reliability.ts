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

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

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

async function tauriInvoke(): Promise<Invoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as Invoke;
  } catch {
    return null;
  }
}

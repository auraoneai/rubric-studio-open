import type { SurfaceMode } from './rubric';

export type SidecarWorkerId =
  | 'iaa-kit'
  | 'judge-bench'
  | 'contamination-audit'
  | 'synthetic-disagreement'
  | 'prompt-rubric-drift';

export type SidecarWorkerStatus = 'ready' | 'disabled' | 'missing-runtime' | 'recovering';

export interface SidecarWorkerHealth {
  id: SidecarWorkerId;
  label: string;
  status: SidecarWorkerStatus;
  capability: string;
  runtime: string;
  recovery: string;
}

export interface SidecarHealthSummary {
  surface: SurfaceMode;
  overallStatus: 'healthy' | 'disabled' | 'attention';
  bundledRuntime: string;
  manager: string;
  timeoutMs: number;
  maxOutputBytes: number;
  restartBackoffMs: number;
  maxAttempts: number;
  networkAllowed: boolean;
  sendsApiKeys: boolean;
  childCrashSafe: boolean;
  workers: SidecarWorkerHealth[];
}

const desktopWorkers: Array<Omit<SidecarWorkerHealth, 'status' | 'runtime' | 'recovery'>> = [
  {
    id: 'iaa-kit',
    label: 'iaa-kit',
    capability: 'Calibration metrics, bootstrap confidence intervals, and agreement trend rows.',
  },
  {
    id: 'judge-bench',
    label: 'judge-bench',
    capability: 'Bias probes for length, position, name, formatting, and refusal sensitivity.',
  },
  {
    id: 'contamination-audit',
    label: 'contamination-audit',
    capability: 'Held-out sample leakage checks before publishing a reproducible eval packet.',
  },
  {
    id: 'synthetic-disagreement',
    label: 'synthetic-disagreement',
    capability: 'Synthetic reviewer split fixtures for onboarding and calibration stress tests.',
  },
  {
    id: 'prompt-rubric-drift',
    label: 'prompt-rubric-drift',
    capability: 'Semantic diff explanations and changed-score impact reports.',
  },
];

export function sidecarHealthSummary(surface: SurfaceMode): SidecarHealthSummary {
  const browser = surface === 'browser';
  return {
    surface,
    overallStatus: browser ? 'disabled' : 'healthy',
    bundledRuntime: browser ? 'not available in Browser Edition' : 'uv-managed Python 3.11 sidecar runtime',
    manager: browser ? 'browser sandbox' : 'Rust core sidecar manager',
    timeoutMs: browser ? 0 : 30_000,
    maxOutputBytes: browser ? 0 : 1_048_576,
    restartBackoffMs: browser ? 0 : 125,
    maxAttempts: browser ? 0 : 2,
    networkAllowed: false,
    sendsApiKeys: false,
    childCrashSafe: !browser,
    workers: desktopWorkers.map((worker) => ({
      ...worker,
      status: browser ? 'disabled' : 'ready',
      runtime: browser ? 'disabled by browser constraints' : 'bundled uv Python runtime',
      recovery: browser
        ? 'Open the desktop app when this workflow requires a local Python worker.'
        : 'The Rust core pipes JSON, caps output, kills timed-out workers, and retries once after a crash.',
    })),
  };
}

export function sidecarWorkerReadiness(summary: SidecarHealthSummary): string {
  if (summary.overallStatus === 'disabled') {
    return 'Python sidecars are disabled in Browser Edition; authoring, validation, preview, and local exports remain available.';
  }
  const ready = summary.workers.filter((worker) => worker.status === 'ready').length;
  return `${ready}/${summary.workers.length} sidecars ready through ${summary.bundledRuntime}; crash restart backoff ${summary.restartBackoffMs}ms.`;
}

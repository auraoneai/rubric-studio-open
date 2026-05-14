import { useEffect, useState } from 'react';
import { configureProviderKey, getKeychainStatus, type KeychainStatus } from '../domain/keychain';
import { detectOllama, type OllamaStatus } from '../domain/ollama';
import { checkForPlatformUpdate, getReliabilityStatus, type ReliabilityStatus, type UpdateCheckResult } from '../domain/reliability';
import type { JudgeConfig, RubricProject, SurfaceMode, TelemetryEvent } from '../domain/rubric';
import { sidecarHealthSummary, sidecarWorkerReadiness } from '../domain/sidecarHealth';
import { studioMessages, supportedLocales, type LocaleCode } from '../domain/i18n';
import { findShortcutConflicts, normalizeShortcut, type ShortcutRow } from '../domain/shortcuts';

export type VisualMode = 'dark' | 'light' | 'high-contrast';
export type UpdateChannel = 'stable' | 'beta';
type DiagnosticSeverity = 'ok' | 'blocked' | 'action';

interface DiagnosticRow {
  id: string;
  label: string;
  status: DiagnosticSeverity;
  message: string;
  action: string;
}

export function SettingsPanel(props: {
  project: RubricProject;
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (value: boolean) => void;
  crashReportingEnabled: boolean;
  setCrashReportingEnabled: (value: boolean) => void;
  updateChannel: UpdateChannel;
  setUpdateChannel: (channel: UpdateChannel) => void;
  noNetworkMode: boolean;
  setNoNetworkMode: (value: boolean) => void;
  telemetryLog: TelemetryEvent[];
  shortcuts: ShortcutRow[];
  visualMode: VisualMode;
  setVisualMode: (mode: VisualMode) => void;
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  onSetShortcut: (action: string, shortcut: string) => void;
  onToggleJudge: (judgeId: string) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
}) {
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({});
  const [keychainStatus, setKeychainStatus] = useState<KeychainStatus | null>(null);
  const [reliabilityStatus, setReliabilityStatus] = useState<ReliabilityStatus | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [updateNotificationDismissed, setUpdateNotificationDismissed] = useState(false);
  const [updateInstallIntent, setUpdateInstallIntent] = useState('');
  const [updateChecking, setUpdateChecking] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [diagnosticsRunAt, setDiagnosticsRunAt] = useState('');
  const shortcutConflicts = findShortcutConflicts(props.shortcuts);
  const diagnostics = operationalDiagnostics(props.surface);
  const sidecarHealth = sidecarHealthSummary(props.surface);
  const messages = studioMessages[props.locale].settings;

  useEffect(() => {
    let cancelled = false;
    getKeychainStatus(props.surface)
      .then((status) => {
        if (!cancelled) {
          setKeychainStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeychainStatus({
            service: 'rubric-studio-open',
            backend: 'unavailable',
            allowed_scopes: ['byo-api-keys'],
            stores_user_content: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.surface]);

  useEffect(() => {
    let cancelled = false;
    getReliabilityStatus(props.surface, props.crashReportingEnabled, props.updateChannel)
      .then((status) => {
        if (!cancelled) {
          setReliabilityStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReliabilityStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.surface, props.crashReportingEnabled, props.updateChannel]);

  async function configureJudge(judge: JudgeConfig) {
    if (judge.provider === 'mock') {
      props.onSetKey(judge.id, true);
      return;
    }
    if (judge.provider === 'ollama') {
      if (props.surface === 'browser') {
        setOllamaStatus(null);
        props.onSetKey(judge.id, false);
        setKeyErrors((current) => ({
          ...current,
          [judge.id]: 'Browser edition cannot detect local Ollama. Open the desktop app for local model judges.',
        }));
        return;
      }
      try {
        const status = await detectOllama();
        setOllamaStatus(status);
        setKeyErrors((current) => ({ ...current, [judge.id]: '' }));
        props.onSetKey(judge.id, true);
      } catch {
        setKeyErrors((current) => ({
          ...current,
          [judge.id]: 'Ollama was not detected at localhost:11434. Start Ollama or install the recommended local judge.',
        }));
      }
      return;
    }

    try {
      const draft = keyDrafts[judge.id]?.trim() ?? '';
      await configureProviderKey(judge, draft, props.surface);
      setKeyDrafts((current) => ({ ...current, [judge.id]: '' }));
      setKeyErrors((current) => ({ ...current, [judge.id]: '' }));
      props.onSetKey(judge.id, true);
      setKeychainStatus(await getKeychainStatus(props.surface));
    } catch (error) {
      setKeyErrors((current) => ({
        ...current,
        [judge.id]: error instanceof Error ? error.message : 'Keychain bridge rejected this provider key.',
      }));
    }
  }

  async function checkForUpdates() {
    setUpdateInstallIntent('');
    setUpdateNotificationDismissed(false);
    if (props.noNetworkMode) {
      setUpdateCheck({
        status: 'unavailable',
        reason: 'No-network mode is active. Update checks stay disabled until networking is re-enabled.',
        checked_at: new Date().toISOString(),
      });
      return;
    }
    setUpdateChecking(true);
    try {
      const result = await checkForPlatformUpdate(props.surface);
      setUpdateCheck(result);
    } finally {
      setUpdateChecking(false);
    }
  }

  return (
    <div className="panel-grid settings-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Keys</p><h2>BYO provider settings</h2></div></div>
        {props.project.judges.map((judge) => (
          <div key={judge.id} className="setting-row">
            <div><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
            <label><input type="checkbox" checked={judge.enabled} onChange={() => props.onToggleJudge(judge.id)} />Enabled</label>
            {judge.provider !== 'mock' && judge.provider !== 'ollama' ? (
              <input
                aria-label={`${judge.label} API key`}
                type="password"
                value={keyDrafts[judge.id] ?? ''}
                placeholder={judge.keyConfigured ? 'Configured in session' : 'Paste BYO key'}
                onChange={(event) => setKeyDrafts((current) => ({ ...current, [judge.id]: event.target.value }))}
              />
            ) : null}
            <button className="glass-button" type="button" onClick={() => configureJudge(judge)}>
              {judge.provider === 'ollama' ? 'Detect Ollama' : judge.keyConfigured ? 'Rotate key' : 'Configure key'}
            </button>
            {keyErrors[judge.id] ? <span className="inline-error" role="alert">{keyErrors[judge.id]}</span> : null}
          </div>
        ))}
        <div className="callout">
          <strong>Local judge</strong>
          <p>Ollama runs at localhost only. Rubric Studio Open detects installed models, uses native streaming for local traces, and never sends local prompts to AuraOne.</p>
          <dl className="status-grid">
            <div><dt>Endpoint</dt><dd>{ollamaStatus?.endpoint ?? 'localhost:11434'}</dd></div>
            <div><dt>Models</dt><dd>{ollamaStatus?.models.map((model) => model.name).join(', ') || 'detect to list'}</dd></div>
            <div><dt>Recommended</dt><dd>{ollamaStatus?.recommendedModel ?? 'llama3.1:8b'}</dd></div>
          </dl>
          <div className="inline-actions">
            <a className="ghost-button" href="https://ollama.com/download" target="_blank" rel="noreferrer">Install Ollama</a>
            <code>ollama pull llama3.1:8b</code>
          </div>
        </div>
        <div className="callout">
          <strong>Key storage</strong>
          <p>{props.surface === 'browser' ? 'Browser edition stores BYO keys in session memory for direct provider calls only.' : 'Desktop routes keys through the OS keychain bridge; never plaintext project files.'}</p>
          <dl className="status-grid">
            <div><dt>Backend</dt><dd>{keychainStatus?.backend ?? 'detecting'}</dd></div>
            <div><dt>Allowed scope</dt><dd>{keychainStatus?.allowed_scopes.join(', ') ?? 'byo-api-keys'}</dd></div>
            <div><dt>User content</dt><dd>{keychainStatus?.stores_user_content ? 'allowed' : 'blocked'}</dd></div>
          </dl>
        </div>
      </section>
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>{messages.displayEyebrow}</p><h2>{messages.themeHeading}</h2></div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={messages.visualModeLabel}>
          {(['dark', 'light', 'high-contrast'] as const).map((mode) => (
            <button
              key={mode}
              className={props.visualMode === mode ? 'active' : ''}
              type="button"
              role="radio"
              aria-checked={props.visualMode === mode}
              onClick={() => props.setVisualMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <label className="setting-row locale-row">
          <span>{messages.interfaceLanguage}</span>
          <select value={props.locale} onChange={(event) => props.setLocale(event.target.value as LocaleCode)}>
            {supportedLocales.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.nativeLabel} ({locale.label})
              </option>
            ))}
          </select>
        </label>
        <p className="subtle">{messages.languageDescription}</p>
        <small className="locale-summary">{messages.localeSummary}</small>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Telemetry</p><h2>Transparent event log</h2></div><label className="switch"><span>Opt in</span><input type="checkbox" checked={props.telemetryEnabled} onChange={(event) => props.setTelemetryEnabled(event.target.checked)} /></label></div>
        <p className="subtle">Collected only when opted in: anonymous install hash, feature usage counts, and error rates. Never rubric content, samples, judge prompts, or API keys.</p>
        <pre className="export-preview" tabIndex={0} aria-label="Transparent telemetry event log JSON">{JSON.stringify(props.telemetryLog, null, 2)}</pre>
      </section>
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Network</p><h2>No-network mode</h2></div>
          <label className="switch">
            <span>Block outbound calls</span>
            <input
              type="checkbox"
              checked={props.noNetworkMode}
              onChange={(event) => props.setNoNetworkMode(event.target.checked)}
            />
          </label>
        </div>
        <p className="subtle">When enabled, Rubric Studio Open keeps authoring, validation, mock scoring, diffing, and local exports available while provider scoring and update checks fail closed.</p>
        <pre className="export-preview" tabIndex={0} aria-label="No-network status JSON">{JSON.stringify({
          enabled: props.noNetworkMode,
          disables: ['provider-scoring', 'update-checks', 'telemetry-upload', 'crash-upload', 'intake-upload'],
          local_features_available: ['authoring', 'validation', 'mock-scoring', 'diff', 'local-export'],
          sends_user_authored_content: false,
        }, null, 2)}</pre>
      </section>
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Diagnostics</p><h2>Operational recovery</h2></div>
          <button className="glass-button" type="button" onClick={() => setDiagnosticsRunAt(new Date().toISOString())}>
            Recheck
          </button>
        </div>
        <div className="diagnostic-grid" aria-label="Operational diagnostics">
          <article className={`diagnostic-card ${sidecarHealth.overallStatus === 'healthy' ? 'ok' : 'blocked'}`}>
            <strong>Sidecar health</strong>
            <span>{sidecarHealth.overallStatus}</span>
            <p>{sidecarWorkerReadiness(sidecarHealth)}</p>
            <small>{sidecarHealth.childCrashSafe ? 'Crash-safe restart enabled through Rust core.' : 'Desktop-only sidecars stay disabled here.'}</small>
          </article>
          {diagnostics.map((row) => (
            <article key={row.id} className={`diagnostic-card ${row.status}`}>
              <strong>{row.label}</strong>
              <span>{row.status}</span>
              <p>{row.message}</p>
              <small>{row.action}</small>
            </article>
          ))}
        </div>
        <pre className="export-preview" tabIndex={0} aria-label="Operational diagnostics JSON">{JSON.stringify({
          checked_at: diagnosticsRunAt || 'not-run-this-session',
          surface: props.surface,
          checks: diagnostics,
          sidecar_health: sidecarHealth,
          recovery_states_covered: ['sidecar-crash', 'git-conflict', 'disk-full', 'missing-dependency'],
        }, null, 2)}</pre>
      </section>
      <section className="glass-panel">
        <div className="panel-title">
          <div><p>Reliability</p><h2>Crash reports and updates</h2></div>
          <label className="switch"><span>Crash reports</span><input type="checkbox" checked={props.crashReportingEnabled} onChange={(event) => props.setCrashReportingEnabled(event.target.checked)} /></label>
        </div>
        <p className="subtle">Crash reporting is off by default. When enabled, reports are scrubbed through the shared Open Studio Platform rules and never include rubric content, samples, judge prompts, or keys.</p>
        <label className="setting-row shortcut-row">
          <span>Update channel</span>
          <select value={props.updateChannel} onChange={(event) => props.setUpdateChannel(event.target.value as UpdateChannel)}>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
        </label>
        <div className="inline-actions">
          <button className="glass-button" type="button" onClick={checkForUpdates} disabled={updateChecking}>
            {updateChecking ? 'Checking...' : props.noNetworkMode ? 'No-network active' : 'Check for updates'}
          </button>
          {updateCheck ? <span className="success-chip" role="status">{updateCheck.status}</span> : null}
        </div>
        {updateCheck?.status === 'available' && !updateNotificationDismissed ? (
          <UpdateNotification
            update={updateCheck}
            currentVersion="0.1.0"
            installIntent={updateInstallIntent}
            onInstallNextLaunch={() => setUpdateInstallIntent(`Queued ${updateCheck.version} for install on next launch.`)}
            onInstallNow={() => setUpdateInstallIntent(`Ready to install ${updateCheck.version}; the desktop app will restart after the signed download verifies.`)}
            onRemindLater={() => setUpdateNotificationDismissed(true)}
          />
        ) : null}
        <pre className="export-preview" tabIndex={0} aria-label="Reliability status JSON">{JSON.stringify({
          crash_reporting_enabled: reliabilityStatus?.crash.enabled ?? props.crashReportingEnabled,
          crash_provider: reliabilityStatus?.crash.provider ?? 'sentry',
          crash_default_off: reliabilityStatus?.crash.default_off ?? true,
          crash_scrubs_api_keys: reliabilityStatus?.crash.scrub_api_keys ?? true,
          update_channel: reliabilityStatus?.updater.channel ?? props.updateChannel,
          update_active: reliabilityStatus?.updater.active ?? true,
          update_endpoints: reliabilityStatus?.updater.endpoints ?? [
            'https://updates.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}',
            'https://updates2.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}',
          ],
          update_pubkey: reliabilityStatus?.updater.pubkey ?? '<PLATFORM_UPDATE_PUBKEY>',
          update_signature_required: reliabilityStatus?.updater.signature_required ?? true,
          update_kill_switch_supported: reliabilityStatus?.updater.kill_switch_supported ?? true,
          update_last_check: updateCheck,
          sends_user_authored_content: reliabilityStatus?.crash.sends_user_authored_content ?? false,
        }, null, 2)}</pre>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Shortcuts</p><h2>Remappable controls</h2></div></div>
        {shortcutConflicts.length > 0 ? (
          <div className="inline-error shortcut-conflict" role="alert">
            {shortcutConflicts.map((conflict) => `${conflict.shortcut}: ${conflict.actions.join(', ')}`).join(' · ')}
          </div>
        ) : (
          <p className="subtle">Every registered command has an editable shortcut. Conflicts are blocked before keyboard dispatch.</p>
        )}
        {props.shortcuts.map(([shortcut, action]) => (
          <label className="setting-row shortcut-row" key={action}>
            <span>{action}</span>
            <input
              aria-label={`${action} shortcut`}
              value={shortcut}
              onChange={(event) => props.onSetShortcut(action, normalizeShortcut(event.target.value))}
            />
          </label>
        ))}
      </section>
    </div>
  );
}

function UpdateNotification({
  update,
  currentVersion,
  installIntent,
  onInstallNextLaunch,
  onInstallNow,
  onRemindLater,
}: {
  update: Extract<UpdateCheckResult, { status: 'available' }>;
  currentVersion: string;
  installIntent: string;
  onInstallNextLaunch: () => void;
  onInstallNow: () => void;
  onRemindLater: () => void;
}) {
  return (
    <aside className="update-notification" role="dialog" aria-label="Update available" aria-live="polite">
      <div className="panel-title">
        <div><p>Signed update</p><h3>Update available</h3></div>
        {update.mandatory ? <span className="success-chip">mandatory</span> : null}
      </div>
      <dl className="status-grid">
        <div><dt>Current</dt><dd>{currentVersion}</dd></div>
        <div><dt>Target</dt><dd>{update.version}</dd></div>
        <div><dt>Released</dt><dd>{update.date ?? 'not provided'}</dd></div>
      </dl>
      <pre className="update-notes" tabIndex={0} aria-label="Update release notes">{update.body || 'No release notes were provided with this signed manifest.'}</pre>
      <details className="signing-details">
        <summary>What&apos;s signed by whom</summary>
        <p>Manifest and bundle signatures are verified against {update.signed_by} before install.</p>
        <a href={update.signing_docs_url} target="_blank" rel="noreferrer">Open signing docs</a>
      </details>
      <div className="inline-actions">
        <button className="glass-button" type="button" onClick={onInstallNextLaunch}>Install on next launch</button>
        <button className="ghost-button" type="button" onClick={onInstallNow}>Install now and restart</button>
        {!update.mandatory ? <button className="link-button" type="button" onClick={onRemindLater}>Remind me later</button> : null}
      </div>
      {update.mandatory ? <p className="subtle">This update is mandatory for the selected channel, so reminder deferral is unavailable.</p> : null}
      {installIntent ? <span className="success-chip" role="status">{installIntent}</span> : null}
    </aside>
  );
}

function operationalDiagnostics(surface: SurfaceMode): DiagnosticRow[] {
  if (surface === 'browser') {
    return [
      {
        id: 'sidecar-crash',
        label: 'Sidecar crash',
        status: 'blocked',
        message: 'Python sidecars are disabled in Browser Edition, so calibration, bias, and contamination workers cannot start here.',
        action: 'Open the desktop app to restart sidecars with the bundled runtime.',
      },
      {
        id: 'git-conflict',
        label: 'Git conflict',
        status: 'blocked',
        message: 'Browser Edition previews semantic diffs but cannot open a three-way local git conflict view.',
        action: 'Export the project bundle or open the desktop app to resolve conflicts.',
      },
      {
        id: 'disk-full',
        label: 'Disk full',
        status: 'action',
        message: 'Browser writes can fail when local storage or the File System Access target is full.',
        action: 'Download a valid bundle, clear space, then retry import/export.',
      },
      {
        id: 'missing-dependency',
        label: 'Missing dependency',
        status: 'ok',
        message: 'Browser Edition needs no Python, git, or OS keychain dependency for local authoring.',
        action: 'Use the desktop app when a project needs sidecars, libgit2, or OS keychain storage.',
      },
    ];
  }

  return [
    {
      id: 'sidecar-crash',
      label: 'Sidecar crash',
      status: 'ok',
      message: 'Desktop sidecars restart through the Rust core lifecycle with user-visible recovery guidance.',
      action: 'Restart the failed sidecar, then rerun the calibration, bias, or contamination job.',
    },
    {
      id: 'git-conflict',
      label: 'Git conflict',
      status: 'action',
      message: 'Conflicts open in the local project folder for a three-way merge instead of rewriting files silently.',
      action: 'Resolve conflict markers, rerun semantic diff, then commit.',
    },
    {
      id: 'disk-full',
      label: 'Disk full',
      status: 'action',
      message: 'Project saves and exports should stop with a clear local-storage or filesystem error.',
      action: 'Free disk space, choose another export folder, then retry.',
    },
    {
      id: 'missing-dependency',
      label: 'Missing dependency',
      status: 'action',
      message: 'Desktop diagnostics identify missing sidecar runtimes, git support, and provider dependencies.',
      action: 'Install the prompted dependency or continue with mock/offline features.',
    },
  ];
}

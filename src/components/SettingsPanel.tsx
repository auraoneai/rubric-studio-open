import { useEffect, useState } from 'react';
import { AuraTelemetryEventLog } from '@auraone/aura-ide-kit';
import { CircleAlert, CircleCheck, DownloadCloud, LoaderCircle, WifiOff } from 'lucide-react';
import {
  configureProviderKey,
  ensureRubricIntakeInstallSigningKeypair,
  getKeychainStatus,
  rubricIntakeInstallSigningKeypairKey,
  type KeychainStatus,
} from '../domain/keychain';
import { detectOllama, type OllamaStatus } from '../domain/ollama';
import { toAuraTelemetryEvents, type TelemetryLogEntry } from '../domain/platformTelemetry';
import { checkForPlatformUpdate, getReliabilityStatus, type ReliabilityStatus, type UpdateCheckResult } from '../domain/reliability';
import { providerModelOptions, type JudgeConfig, type RubricProject, type SurfaceMode } from '../domain/rubric';
import { findShortcutConflicts, normalizeShortcut, type ShortcutRow } from '../domain/shortcuts';
import { runOperationalDiagnostics, type DiagnosticRow } from '../domain/diagnostics';

export type VisualMode = 'light' | 'high-contrast';
export type UpdateChannel = 'stable' | 'beta';
export function SettingsPanel(props: {
  project: RubricProject;
  surface: SurfaceMode;
  openedProjectPath: string | null;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (value: boolean) => void;
  crashReportingEnabled: boolean;
  setCrashReportingEnabled: (value: boolean) => void;
  updateChannel: UpdateChannel;
  setUpdateChannel: (channel: UpdateChannel) => void;
  noNetworkMode: boolean;
  setNoNetworkMode: (value: boolean) => void;
  telemetryLog: TelemetryLogEntry[];
  shortcuts: ShortcutRow[];
  visualMode: VisualMode;
  setVisualMode: (mode: VisualMode) => void;
  onSetShortcut: (action: string, shortcut: string) => void;
  onToggleJudge: (judgeId: string) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
  onUpdateJudge: (judgeId: string, patch: Partial<Pick<JudgeConfig, 'model' | 'label'>>) => void;
}) {
  const settingsNav = [
    ['Provider keys', 'settings-provider-keys'],
    ['Theme & contrast', 'settings-theme'],
    ['Telemetry', 'settings-telemetry'],
    ['Network', 'settings-network'],
    ['Operational recovery', 'settings-recovery'],
    ['Crash reporting', 'settings-reliability'],
    ['Shortcuts', 'settings-shortcuts'],
  ] as const;
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({});
  const [keychainStatus, setKeychainStatus] = useState<KeychainStatus | null>(null);
  const [intakeIdentityStatus, setIntakeIdentityStatus] = useState(
    props.surface === 'browser'
      ? 'Unavailable in browser; no key generated'
      : 'Checking desktop keychain',
  );
  const [reliabilityStatus, setReliabilityStatus] = useState<ReliabilityStatus | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [diagnosticsRunAt, setDiagnosticsRunAt] = useState('');
  const [diagnosticsChecking, setDiagnosticsChecking] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRow[]>([]);
  const shortcutConflicts = findShortcutConflicts(props.shortcuts);

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
            allowed_scopes: props.surface === 'browser'
              ? ['byo-api-keys']
              : ['byo-api-keys', 'intake-install-signing-key'],
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
    if (props.surface === 'browser') {
      setIntakeIdentityStatus('Unavailable in browser; no key generated');
      return () => {
        cancelled = true;
      };
    }
    void ensureRubricIntakeInstallSigningKeypair(props.surface)
      .then((keypair) => {
        if (!cancelled) {
          setIntakeIdentityStatus(
            `Ed25519 identity stored in the OS keychain · created ${new Date(
              keypair.created_at,
            ).toLocaleDateString()}`,
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setIntakeIdentityStatus(
            error instanceof Error
              ? error.message
              : 'Intake identity is unavailable.',
          );
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

  useEffect(() => {
    void recheckDiagnostics();
  }, [props.surface, props.openedProjectPath, props.project.id]);

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
      setUpdateCheck(await checkForPlatformUpdate(props.surface));
    } finally {
      setUpdateChecking(false);
    }
  }

  async function recheckDiagnostics() {
    setDiagnosticsChecking(true);
    try {
      const checks = await runOperationalDiagnostics({
        surface: props.surface,
        project: props.project,
        openedProjectPath: props.openedProjectPath,
      });
      setDiagnostics(checks);
      setDiagnosticsRunAt(new Date().toISOString());
    } finally {
      setDiagnosticsChecking(false);
    }
  }

  return (
    <div className="rs-surface rs-settings-surface">
      <header className="rs-settings-hero">
        <div className="rs-eyebrow">Settings</div>
        <h2>Studio behavior</h2>
      </header>
      <div className="rs-settings-body">
        <aside className="rs-settings-nav" tabIndex={0} aria-label="Settings sections">
          {settingsNav.map(([item, id], index) => (
            <button
              key={item}
              className={index === 0 ? 'active' : ''}
              type="button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
            >
              {item}
            </button>
          ))}
        </aside>
        <section className="rs-settings-main">
          <section className="rs-settings-section" id="settings-provider-keys">
            <header>
              <span>01</span>
              <div>
                <h3>BYO provider keys</h3>
                <p>{props.surface === 'browser'
                  ? 'Browser keys remain in session memory and are used only for an explicit direct provider run.'
                  : 'Desktop routes keys through the OS keychain bridge; never plaintext in project files.'}</p>
              </div>
            </header>
        {props.project.judges.map((judge) => (
          <div key={judge.id} className="rs-provider-row">
            <div className="setting-identity"><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
            <label className="setting-enabled"><input type="checkbox" checked={judge.enabled} onChange={() => props.onToggleJudge(judge.id)} />Enabled</label>
            {isConfigurableProvider(judge) ? (
              <label className="model-picker">
                <span>Model</span>
                <input
                  list={`${judge.id}-model-options`}
                  aria-label={`${judge.label} model ID`}
                  value={judge.model}
                  onChange={(event) => props.onUpdateJudge(judge.id, {
                    model: event.target.value,
                    label: labelForModel(judge.provider, event.target.value),
                  })}
                />
                <datalist id={`${judge.id}-model-options`}>
                  {providerModelOptions[judge.provider].map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
            ) : <input aria-label={`${judge.label} model auto-detect`} value="auto-detect" disabled readOnly />}
            {judge.provider !== 'mock' && judge.provider !== 'ollama' ? (
              <input
                className="provider-key-input"
                aria-label={`${judge.label} API key`}
                type="password"
                value={keyDrafts[judge.id] ?? ''}
                placeholder={judge.keyConfigured ? 'Configured in session' : 'Paste BYO key'}
                onChange={(event) => setKeyDrafts((current) => ({ ...current, [judge.id]: event.target.value }))}
              />
            ) : <input aria-label={`${judge.label} key storage auto-detect`} value="auto-detect" disabled readOnly />}
            <button className="solid-button configure-key-button" type="button" onClick={() => configureJudge(judge)}>
              {judge.provider === 'ollama' ? 'Detect Ollama' : judge.keyConfigured ? 'Rotate key' : 'Configure key'}
            </button>
            {keyErrors[judge.id] ? <span className="inline-error" role="alert">{keyErrors[judge.id]}</span> : null}
          </div>
        ))}
        <div className="rs-key-storage">
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
        <div className="rs-key-storage">
          <strong>Key storage</strong>
          <p>{props.surface === 'browser' ? 'Browser edition stores BYO keys in session memory for direct provider calls only.' : 'Desktop routes keys through the OS keychain bridge; never plaintext project files.'}</p>
          <dl className="status-grid">
            <div><dt>Backend</dt><dd>{keychainStatus?.backend ?? 'detecting'}</dd></div>
            <div><dt>Allowed scope</dt><dd>{keychainStatus?.allowed_scopes.join(', ') ?? 'byo-api-keys'}</dd></div>
            <div><dt>User content</dt><dd>{keychainStatus?.stores_user_content ? 'allowed' : 'blocked'}</dd></div>
            <div><dt>Intake identity</dt><dd>{intakeIdentityStatus}</dd></div>
            <div><dt>Intake key scope</dt><dd>{rubricIntakeInstallSigningKeypairKey.scope}</dd></div>
          </dl>
        </div>
      </section>
      <section className="rs-settings-section rs-theme-section" id="settings-theme">
        <header>
          <span>02</span>
          <div><h3>Theme & contrast</h3><p>Studio matches OS by default; pick a forced mode if you prefer.</p></div>
        </header>
        <div className="segmented" role="radiogroup" aria-label="Visual mode">
          {(['light', 'high-contrast'] as const).map((mode) => (
            <button
              key={mode}
              className={props.visualMode === mode ? 'active' : ''}
              type="button"
              role="radio"
              aria-checked={props.visualMode === mode}
              onClick={() => props.setVisualMode(mode)}
            >
              {mode === 'high-contrast' ? 'High contrast' : mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <div className="rs-settings-extra">
      <section className="surface-panel" id="settings-telemetry">
        <div className="panel-title"><div><p>Telemetry preview</p><h2>Local preview, not sent</h2></div><label className="switch"><span>Preview opt-in</span><input type="checkbox" checked={props.telemetryEnabled} onChange={(event) => props.setTelemetryEnabled(event.target.checked)} /></label></div>
        <p className="subtle">No telemetry uploader is configured in this build. Opted-in records are labeled local preview; opted-out records are labeled would send. Neither status means uploaded. The preview never includes rubric content, samples, judge prompts, or API keys.</p>
        <AuraTelemetryEventLog events={toAuraTelemetryEvents(props.telemetryLog)} />
        <pre className="export-preview" tabIndex={0} aria-label="Local telemetry preview JSON, not sent">{JSON.stringify(props.telemetryLog, null, 2)}</pre>
      </section>
      <section className="surface-panel" id="settings-network">
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
          disables: ['provider-scoring', 'update-checks', 'crash-upload'],
          telemetry_delivery: 'local-preview-only-no-uploader',
          local_features_available: ['authoring', 'validation', 'mock-scoring', 'diff', 'local-export'],
          sends_user_authored_content: false,
        }, null, 2)}</pre>
      </section>
      <section className="surface-panel" id="settings-recovery">
        <div className="panel-title">
          <div><p>Diagnostics</p><h2>Operational recovery</h2></div>
          <button className="solid-button" type="button" disabled={diagnosticsChecking} onClick={() => void recheckDiagnostics()}>
            {diagnosticsChecking ? 'Checking...' : 'Recheck'}
          </button>
        </div>
        <div className="diagnostic-grid" aria-label="Operational diagnostics">
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
          checks_executed: diagnostics.map((row) => row.id),
        }, null, 2)}</pre>
      </section>
      <section className="surface-panel" id="settings-reliability">
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
          <button className="solid-button" type="button" onClick={checkForUpdates} disabled={updateChecking}>
            {updateChecking ? 'Checking...' : props.noNetworkMode ? 'No-network active' : 'Check for updates'}
          </button>
        </div>
        <UpdateState
          checking={updateChecking}
          result={updateCheck}
          noNetworkMode={props.noNetworkMode}
          channel={props.updateChannel}
        />
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
          update_pubkey: reliabilityStatus?.updater.pubkey ?? 'DAKD/Nqj4KoXZpXv9li/zVQv+2LhThXE5J9tx0Wl1B8=',
          update_signature_required: reliabilityStatus?.updater.signature_required ?? true,
          update_kill_switch_supported: reliabilityStatus?.updater.kill_switch_supported ?? true,
          update_last_check: updateCheck,
          sends_user_authored_content: reliabilityStatus?.crash.sends_user_authored_content ?? false,
        }, null, 2)}</pre>
      </section>
      <section className="surface-panel" id="settings-shortcuts">
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
        </section>
      </div>
    </div>
  );
}

function UpdateState({
  checking,
  result,
  noNetworkMode,
  channel,
}: {
  checking: boolean;
  result: UpdateCheckResult | null;
  noNetworkMode: boolean;
  channel: UpdateChannel;
}) {
  if (checking) {
    return (
      <div className="update-state info" role="status">
        <LoaderCircle className="button-icon update-spinner" aria-hidden="true" />
        <div><strong>Checking for signed updates</strong><p>{channel} channel · verifying release metadata and signature.</p></div>
      </div>
    );
  }
  if (noNetworkMode) {
    return (
      <div className="update-state blocked" role="status">
        <WifiOff className="button-icon" aria-hidden="true" />
        <div><strong>Update checks are blocked</strong><p>No-network mode is active. Re-enable networking to check the {channel} channel.</p></div>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="update-state neutral" role="status">
        <DownloadCloud className="button-icon" aria-hidden="true" />
        <div><strong>Update status not checked</strong><p>{channel} channel · signed packages only.</p></div>
      </div>
    );
  }
  if (result.status === 'current') {
    return (
      <div className="update-state success" role="status">
        <CircleCheck className="button-icon" aria-hidden="true" />
        <div><strong>Rubric Studio Open is current</strong><p>{channel} channel · checked {formatCheckedAt(result.checked_at)}.</p></div>
      </div>
    );
  }
  if (result.status === 'available') {
    return (
      <div className="update-state review" role="status">
        <DownloadCloud className="button-icon" aria-hidden="true" />
        <div>
          <strong>Version {result.version} is available</strong>
          <p>{result.body || 'A signed update is ready.'} Restart after the updater finishes installing.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="update-state danger" role="alert">
      <CircleAlert className="button-icon" aria-hidden="true" />
      <div>
        <strong>{result.status === 'unavailable' ? 'Updates unavailable on this surface' : 'Update check failed'}</strong>
        <p>{result.reason}</p>
      </div>
    </div>
  );
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isConfigurableProvider(
  judge: JudgeConfig,
): judge is JudgeConfig & { provider: keyof typeof providerModelOptions } {
  return judge.provider === 'openai' || judge.provider === 'anthropic' || judge.provider === 'google';
}

function labelForModel(provider: keyof typeof providerModelOptions, model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    if (provider === 'openai') return 'OpenAI custom';
    if (provider === 'anthropic') return 'Claude custom';
    return 'Gemini custom';
  }
  if (trimmed === 'gpt-5.2') return 'OpenAI GPT-5.2';
  if (trimmed === 'gpt-5.2-pro') return 'OpenAI GPT-5.2 Pro';
  if (trimmed === 'gpt-5.5') return 'OpenAI GPT-5.5';
  if (trimmed === 'gpt-5.5-pro') return 'OpenAI GPT-5.5 Pro';
  if (trimmed.startsWith('gpt-')) return `OpenAI ${trimmed.toUpperCase()}`;
  if (trimmed === 'claude-opus-4-7') return 'Claude Opus 4.7';
  if (trimmed === 'claude-opus-4-1-20250805') return 'Claude Opus 4.1';
  if (trimmed === 'claude-sonnet-4-20250514') return 'Claude Sonnet 4';
  if (trimmed.startsWith('claude-')) return `Claude ${trimmed.replace(/^claude-/, '')}`;
  if (trimmed === 'gemini-3.1-pro-preview' || trimmed === 'gemini-3.1-pro') return 'Gemini 3.1 Pro';
  if (trimmed === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  if (trimmed.startsWith('gemini-')) return `Gemini ${trimmed.replace(/^gemini-/, '')}`;
  return trimmed;
}

import { useEffect, useState } from 'react';
import { configureProviderKey, getKeychainStatus, type KeychainStatus } from '../domain/keychain';
import { detectOllama, type OllamaStatus } from '../domain/ollama';
import type { JudgeConfig, RubricProject, SurfaceMode, TelemetryEvent } from '../domain/rubric';
import { findShortcutConflicts, normalizeShortcut, type ShortcutRow } from '../domain/shortcuts';

export type VisualMode = 'dark' | 'light' | 'high-contrast';
export type UpdateChannel = 'stable' | 'beta';

export function SettingsPanel(props: {
  project: RubricProject;
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (value: boolean) => void;
  crashReportingEnabled: boolean;
  setCrashReportingEnabled: (value: boolean) => void;
  updateChannel: UpdateChannel;
  setUpdateChannel: (channel: UpdateChannel) => void;
  telemetryLog: TelemetryEvent[];
  shortcuts: ShortcutRow[];
  visualMode: VisualMode;
  setVisualMode: (mode: VisualMode) => void;
  onSetShortcut: (action: string, shortcut: string) => void;
  onToggleJudge: (judgeId: string) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
}) {
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({});
  const [keychainStatus, setKeychainStatus] = useState<KeychainStatus | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
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
            allowed_scopes: ['byo-api-keys'],
            stores_user_content: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.surface]);

  async function configureJudge(judge: JudgeConfig) {
    if (judge.provider === 'mock') {
      props.onSetKey(judge.id, true);
      return;
    }
    if (judge.provider === 'ollama') {
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
          <div><p>Display</p><h2>Theme and contrast</h2></div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Visual mode">
          {(['dark', 'light', 'high-contrast'] as const).map((mode) => (
            <button
              key={mode}
              className={props.visualMode === mode ? 'active' : ''}
              type="button"
              onClick={() => props.setVisualMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>
      <section className="glass-panel">
        <div className="panel-title"><div><p>Telemetry</p><h2>Transparent event log</h2></div><label className="switch"><span>Opt in</span><input type="checkbox" checked={props.telemetryEnabled} onChange={(event) => props.setTelemetryEnabled(event.target.checked)} /></label></div>
        <p className="subtle">Collected only when opted in: anonymous install hash, feature usage counts, and error rates. Never rubric content, samples, judge prompts, or API keys.</p>
        <pre className="export-preview">{JSON.stringify(props.telemetryLog, null, 2)}</pre>
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
        <pre className="export-preview">{JSON.stringify({
          crash_reporting_enabled: props.crashReportingEnabled,
          update_channel: props.updateChannel,
          primary_update_endpoint: 'https://updates.auraone.ai/rubric-studio-open',
          fallback_update_endpoint: 'https://updates2.auraone.ai/rubric-studio-open',
          sends_api_keys: false,
          sends_user_authored_content: false,
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

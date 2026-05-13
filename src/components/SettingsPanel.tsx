import type { RubricProject, SurfaceMode, TelemetryEvent } from '../domain/rubric';

export type VisualMode = 'dark' | 'light' | 'high-contrast';
export type ShortcutRow = [string, string];

export function SettingsPanel(props: {
  project: RubricProject;
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (value: boolean) => void;
  telemetryLog: TelemetryEvent[];
  shortcuts: ShortcutRow[];
  visualMode: VisualMode;
  setVisualMode: (mode: VisualMode) => void;
  onSetShortcut: (action: string, shortcut: string) => void;
  onToggleJudge: (judgeId: string) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
}) {
  return (
    <div className="panel-grid settings-grid">
      <section className="glass-panel">
        <div className="panel-title"><div><p>Keys</p><h2>BYO provider settings</h2></div></div>
        {props.project.judges.map((judge) => (
          <div key={judge.id} className="setting-row">
            <div><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
            <label><input type="checkbox" checked={judge.enabled} onChange={() => props.onToggleJudge(judge.id)} />Enabled</label>
            <button className="glass-button" type="button" onClick={() => props.onSetKey(judge.id, !judge.keyConfigured)}>
              {judge.keyConfigured ? 'Rotate key' : 'Configure key'}
            </button>
          </div>
        ))}
        <div className="callout"><strong>Key storage</strong><p>{props.surface === 'browser' ? 'Browser edition stores BYO keys in session memory for direct provider calls only.' : 'Desktop routes keys through the OS keychain bridge; never plaintext project files.'}</p></div>
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
        <div className="panel-title"><div><p>Shortcuts</p><h2>Remappable controls</h2></div></div>
        {props.shortcuts.map(([shortcut, action]) => (
          <label className="setting-row shortcut-row" key={action}>
            <span>{action}</span>
            <input value={shortcut} onChange={(event) => props.onSetShortcut(action, event.target.value)} />
          </label>
        ))}
      </section>
    </div>
  );
}

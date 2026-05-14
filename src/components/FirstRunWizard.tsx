import { useRef, useState } from 'react';
import { configureProviderKey } from '../domain/keychain';
import { detectOllama } from '../domain/ollama';
import type { JudgeConfig, SurfaceMode } from '../domain/rubric';
import { RubricStudioMark } from './RubricStudioMark';
import { useDialogFocusTrap } from './useDialogFocusTrap';

export function FirstRunWizard({
  judges,
  surface,
  telemetryEnabled,
  crashReportingEnabled,
  onTelemetryChange,
  onCrashReportingChange,
  onSetKey,
  onSkip,
  onStart,
  onScoreSample,
}: {
  judges: JudgeConfig[];
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
  onTelemetryChange: (enabled: boolean) => void;
  onCrashReportingChange: (enabled: boolean) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
  onSkip: () => void;
  onStart: () => void;
  onScoreSample: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const setupJudges = judges.filter((judge) => judge.provider !== 'mock');
  useDialogFocusTrap(dialogRef);

  async function configureJudge(judge: JudgeConfig) {
    if (judge.provider === 'ollama') {
      if (surface === 'browser') {
        onSetKey(judge.id, false);
        setStatus((current) => ({
          ...current,
          [judge.id]: 'Browser edition cannot detect local Ollama. Open the desktop app for local model judges.',
        }));
        return;
      }
      try {
        const result = await detectOllama();
        onSetKey(judge.id, true);
        setStatus((current) => ({
          ...current,
          [judge.id]: `Detected ${result.models.length || 'local'} model${result.models.length === 1 ? '' : 's'}`,
        }));
      } catch {
        setStatus((current) => ({
          ...current,
          [judge.id]: 'Ollama not detected. Install it or continue with remote BYO keys.',
        }));
      }
      return;
    }

    try {
      await configureProviderKey(judge, keyDrafts[judge.id] ?? '', surface);
      onSetKey(judge.id, true);
      setKeyDrafts((current) => ({ ...current, [judge.id]: '' }));
      setStatus((current) => ({ ...current, [judge.id]: 'Configured for this session' }));
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [judge.id]: error instanceof Error ? error.message : 'Could not configure this key.',
      }));
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="wizard wide"
        role="dialog"
        aria-modal="true"
        aria-label="First-run wizard"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onSkip();
          }
        }}
      >
        <div className="app-icon large" aria-hidden="true">
          <RubricStudioMark size={58} />
        </div>
        <h2>Sixty seconds to first value</h2>
        <div className="wizard-steps">
          <div><strong>1. Look at the rubric</strong><span>A 12-criterion helpful-response project is preloaded with themes, samples, and judges.</span></div>
          <div><strong>2. Score this sample</strong><span>The local mock judge works immediately; configured providers unlock direct model scoring.</span></div>
          <div><strong>3. Read the diff</strong><span>Open semantic diff to see score impact before exporting or committing the rubric.</span></div>
        </div>
        <div className="key-setup" aria-label="BYO key setup">
          {setupJudges.map((judge) => (
            <div className="setting-row" key={judge.id}>
              <div><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
              {judge.provider === 'ollama' ? (
                <code>ollama pull llama3.1:8b</code>
              ) : (
                <input
                  aria-label={`${judge.label} first-run API key`}
                  type="password"
                  value={keyDrafts[judge.id] ?? ''}
                  placeholder={judge.keyConfigured ? 'Configured' : 'Paste BYO key'}
                  onChange={(event) => setKeyDrafts((current) => ({ ...current, [judge.id]: event.target.value }))}
                />
              )}
              <button className="glass-button" type="button" onClick={() => configureJudge(judge)}>
                {judge.provider === 'ollama' ? 'Detect local judge' : judge.keyConfigured ? 'Rotate key' : 'Configure key'}
              </button>
              {status[judge.id] ? <span className={judge.keyConfigured ? 'success-chip' : 'inline-error'}>{status[judge.id]}</span> : null}
            </div>
          ))}
        </div>
        <div className="wizard-consent">
          <label className="switch"><span>Telemetry</span><input type="checkbox" checked={telemetryEnabled} onChange={(event) => onTelemetryChange(event.target.checked)} /></label>
          <label className="switch"><span>Crash reports</span><input type="checkbox" checked={crashReportingEnabled} onChange={(event) => onCrashReportingChange(event.target.checked)} /></label>
        </div>
        <p className="subtle">Both reporting switches are off by default. Neither sends rubric content, samples, judge prompts, or API keys.</p>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onSkip}>Skip</button>
          <button className="glass-button" type="button" onClick={onScoreSample}>Score sample now</button>
          <button className="glass-button primary" type="button" onClick={onStart}>Start tour</button>
        </div>
      </section>
    </div>
  );
}

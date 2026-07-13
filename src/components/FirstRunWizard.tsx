import { useState } from 'react';
import { configureProviderKey } from '../domain/keychain';
import { detectOllama } from '../domain/ollama';
import { providerModelOptions, type JudgeConfig, type SurfaceMode } from '../domain/rubric';
import { useOverlayFocus } from './useOverlayFocus';

export function FirstRunWizard({
  judges,
  surface,
  telemetryEnabled,
  crashReportingEnabled,
  onTelemetryChange,
  onCrashReportingChange,
  onSetKey,
  onUpdateJudge,
  onSkip,
  onStart,
}: {
  judges: JudgeConfig[];
  surface: SurfaceMode;
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
  onTelemetryChange: (enabled: boolean) => void;
  onCrashReportingChange: (enabled: boolean) => void;
  onSetKey: (judgeId: string, configured: boolean) => void;
  onUpdateJudge: (judgeId: string, patch: Partial<Pick<JudgeConfig, 'model' | 'label'>>) => void;
  onSkip: () => void;
  onStart: () => void;
}) {
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const setupJudges = judges.filter((judge) => judge.provider !== 'mock');
  const dialogRef = useOverlayFocus<HTMLElement>({
    open: true,
    onClose: onSkip,
    initialFocus: '.wizard .primary',
  });

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
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="wizard wide" role="dialog" aria-modal="true" aria-label="First-run wizard">
        <div className="app-icon large rubric-brand-mark" aria-hidden="true">A</div>
        <h2>Start locally. Connect only when you choose.</h2>
        <div className="wizard-steps">
          <div><strong>1. Open a local project</strong><span>The starter rubric is ready now; desktop can open a folder and browser uses local storage.</span></div>
          <div><strong>2. Review the network boundary</strong><span>Authoring, validation, mock scoring, diff, and local export work without an account or network call.</span></div>
          <div><strong>3. Run the workflow</strong><span>Author a criterion, score the included sample, calibrate evidence, and review the semantic diff.</span></div>
          <div><strong>4. Export evidence</strong><span>Downloads remain local. Provider calls happen only after an explicit action, and evidence packages are clearly unsigned.</span></div>
        </div>
        <div className="key-setup" aria-label="BYO key setup">
          {setupJudges.map((judge) => (
            <div className="setting-row" key={judge.id}>
              <div><strong>{judge.label}</strong><small>{judge.provider}/{judge.model}</small></div>
              {judge.provider === 'ollama' ? (
                <code>ollama pull llama3.1:8b</code>
              ) : isConfigurableProvider(judge) ? (
                <>
                  <label className="model-picker">
                    <span>Model</span>
                    <input
                      list={`${judge.id}-first-run-model-options`}
                      aria-label={`${judge.label} first-run model ID`}
                      value={judge.model}
                      onChange={(event) => onUpdateJudge(judge.id, {
                        model: event.target.value,
                        label: labelForModel(judge.provider, event.target.value),
                      })}
                    />
                    <datalist id={`${judge.id}-first-run-model-options`}>
                      {providerModelOptions[judge.provider].map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </label>
                  <input
                    aria-label={`${judge.label} first-run API key`}
                    type="password"
                    value={keyDrafts[judge.id] ?? ''}
                    placeholder={judge.keyConfigured ? 'Configured' : 'Paste BYO key'}
                    onChange={(event) => setKeyDrafts((current) => ({ ...current, [judge.id]: event.target.value }))}
                  />
                </>
              ) : (
                <input
                  aria-label={`${judge.label} first-run API key`}
                  type="password"
                  value={keyDrafts[judge.id] ?? ''}
                  placeholder={judge.keyConfigured ? 'Configured' : 'Paste BYO key'}
                  onChange={(event) => setKeyDrafts((current) => ({ ...current, [judge.id]: event.target.value }))}
                />
              )}
              <button className="solid-button" type="button" onClick={() => configureJudge(judge)}>
                {judge.provider === 'ollama' ? 'Detect local judge' : judge.keyConfigured ? 'Rotate key' : 'Configure key'}
              </button>
              {status[judge.id] ? <span className={judge.keyConfigured ? 'success-chip' : 'inline-error'}>{status[judge.id]}</span> : null}
            </div>
          ))}
        </div>
        <div className="wizard-consent">
          <label className="switch"><span>Telemetry preview</span><input type="checkbox" checked={telemetryEnabled} onChange={(event) => onTelemetryChange(event.target.checked)} /></label>
          <label className="switch"><span>Crash reports</span><input type="checkbox" checked={crashReportingEnabled} onChange={(event) => onCrashReportingChange(event.target.checked)} /></label>
        </div>
        <p className="subtle" role="note">Telemetry preview and crash reporting are off by default. No telemetry uploader is configured; preview events stay local and are not sent. Provider keys are optional, and onboarding never sends rubric content, samples, judge prompts, or API keys.</p>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onSkip}>Skip</button>
          <button className="solid-button primary" type="button" onClick={onStart}>Start tour</button>
        </div>
      </section>
    </div>
  );
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

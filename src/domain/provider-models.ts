import type { JudgeConfig } from './rubric';

export type RemoteProvider = Extract<JudgeConfig['provider'], 'openai' | 'anthropic' | 'google'>;

export interface ProviderModelOption {
  label: string;
  model: string;
  description: string;
}

export const providerModelOptions: Record<RemoteProvider, ProviderModelOption[]> = {
  openai: [
    { label: 'GPT-5.5', model: 'gpt-5.5', description: 'Flagship reasoning and coding model' },
    { label: 'GPT-5.4', model: 'gpt-5.4', description: 'Lower-cost frontier model' },
    { label: 'GPT-5.4 mini', model: 'gpt-5.4-mini', description: 'Fast judge sweeps' },
    { label: 'GPT-5.4 nano', model: 'gpt-5.4-nano', description: 'Lowest-latency checks' },
  ],
  anthropic: [
    { label: 'Claude Opus 4.7', model: 'claude-opus-4-7', description: 'Most capable Claude model' },
    { label: 'Claude Sonnet 4.6', model: 'claude-sonnet-4-6', description: 'Balanced speed and intelligence' },
    { label: 'Claude Haiku 4.5', model: 'claude-haiku-4-5-20251001', description: 'Fast near-frontier judge' },
  ],
  google: [
    { label: 'Gemini Pro 3.1', model: 'gemini-3.1-pro', description: 'Advanced reasoning and agentic workflows' },
    { label: 'Gemini 3 Flash Preview', model: 'gemini-3-flash-preview', description: 'Frontier-class low-cost judge' },
    { label: 'Gemini 3.1 Flash-Lite', model: 'gemini-3.1-flash-lite', description: 'Stable high-volume judge' },
    { label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', description: 'Deep reasoning fallback' },
    { label: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', description: 'Low-latency fallback' },
  ],
};

export function isRemoteProvider(provider: JudgeConfig['provider']): provider is RemoteProvider {
  return provider === 'openai' || provider === 'anthropic' || provider === 'google';
}

export function modelsForProvider(provider: JudgeConfig['provider']): ProviderModelOption[] {
  return isRemoteProvider(provider) ? providerModelOptions[provider] : [];
}

export function providerModelLabel(provider: JudgeConfig['provider'], model: string): string {
  if (!isRemoteProvider(provider)) {
    return model;
  }
  return providerModelOptions[provider].find((option) => option.model === model)?.label ?? model;
}

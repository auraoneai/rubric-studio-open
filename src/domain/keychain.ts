import type { JudgeConfig, SurfaceMode } from './rubric';

export interface KeychainKey {
  service: string;
  scope: 'byo-api-keys';
  identifier: string;
}

export interface KeychainReceipt {
  service: string;
  scope: string;
  identifier_hash: string;
  backend: string;
  native_bridge_required: boolean;
  stores_user_content: boolean;
}

export interface KeychainStatus {
  service: string;
  backend: string;
  allowed_scopes: string[];
  stores_user_content: boolean;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const browserKeyPrefix = 'rso:key';
const browserSecretPrefix = 'rso:secret';

export function keychainKeyForJudge(judge: JudgeConfig): KeychainKey {
  return {
    service: 'rubric-studio-open',
    scope: 'byo-api-keys',
    identifier: slugKeychainIdentifier(`${judge.provider}-${judge.id}`),
  };
}

export function validateProviderSecret(secret: string): string | null {
  if (secret.trim().length < 8) {
    return 'Paste a provider key before configuring this judge.';
  }
  return null;
}

export async function configureProviderKey(
  judge: JudgeConfig,
  secret: string,
  surface: SurfaceMode,
): Promise<KeychainReceipt> {
  const validationError = validateProviderSecret(secret);
  if (validationError) {
    throw new Error(validationError);
  }
  const key = keychainKeyForJudge(judge);
  if (surface === 'browser') {
    sessionStorage.setItem(browserProviderMarker(judge), 'configured');
    sessionStorage.setItem(browserProviderSecretKey(judge), secret.trim());
    return {
      service: key.service,
      scope: key.scope,
      identifier_hash: stableHash(key.identifier).slice(0, 16),
      backend: 'browser-session-memory',
      native_bridge_required: false,
      stores_user_content: false,
    };
  }

  const invoke = await loadTauriInvoke();
  if (!invoke || window.__TAURI_INTERNALS__ === undefined) {
    throw new Error('Desktop keychain bridge is available only inside the Tauri desktop shell.');
  }

  return invoke<KeychainReceipt>('platform_keychain_set', {
    key,
    value: secret,
    secret: true,
  });
}

export function readBrowserProviderSecret(judge: JudgeConfig): string | null {
  return sessionStorage.getItem(browserProviderSecretKey(judge));
}

export async function getKeychainStatus(surface: SurfaceMode): Promise<KeychainStatus> {
  if (surface === 'browser') {
    return {
      service: 'rubric-studio-open',
      backend: 'browser-session-memory',
      allowed_scopes: ['byo-api-keys'],
      stores_user_content: false,
    };
  }
  const invoke = await loadTauriInvoke();
  if (!invoke || window.__TAURI_INTERNALS__ === undefined) {
    return {
      service: 'rubric-studio-open',
      backend: 'desktop-keychain-bridge-unavailable-in-browser-preview',
      allowed_scopes: ['byo-api-keys'],
      stores_user_content: false,
    };
  }
  return invoke<KeychainStatus>('platform_keychain_status');
}

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  try {
    const api = await import('@tauri-apps/api/core');
    return api.invoke as TauriInvoke;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function slugKeychainIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function browserProviderMarker(judge: JudgeConfig): string {
  return `${browserKeyPrefix}:${judge.provider}:${judge.id}`;
}

function browserProviderSecretKey(judge: JudgeConfig): string {
  return `${browserSecretPrefix}:${judge.provider}:${judge.id}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(16, '0');
}

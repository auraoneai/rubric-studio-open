import type { JudgeConfig, SurfaceMode } from './rubric';

export interface KeychainKey {
  service: string;
  scope: 'byo-api-keys' | 'intake-install-signing-key';
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

export interface IntakeInstallSigningKeypair {
  algorithm: 'Ed25519';
  public_key: string;
  private_key: string;
  created_at: string;
}

interface PlatformKeychainKey {
  service: string;
  scope: KeychainKey['scope'];
  identifier: string;
}

interface PlatformKeychainApi {
  set(key: PlatformKeychainKey, value: string): Promise<void>;
  get(key: PlatformKeychainKey): Promise<string | null>;
  delete(key: PlatformKeychainKey): Promise<void>;
  list(service: string, scope: PlatformKeychainKey['scope']): Promise<string[]>;
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

export async function ensureRubricIntakeInstallSigningKeypair(
  surface: SurfaceMode,
): Promise<IntakeInstallSigningKeypair> {
  if (surface === 'browser') {
    return ensureIntakeInstallSigningKeypair(browserKeychainApi(), 'rubric-studio-open', createBrowserIntakeKeypair);
  }

  const invoke = await loadTauriInvoke();
  if (!invoke || window.__TAURI_INTERNALS__ === undefined) {
    throw new Error('Desktop keychain bridge is available only inside the Tauri desktop shell.');
  }

  return ensureIntakeInstallSigningKeypair(tauriKeychainApi(invoke), 'rubric-studio-open', createBrowserIntakeKeypair);
}

export function readBrowserProviderSecret(judge: JudgeConfig): string | null {
  return sessionStorage.getItem(browserProviderSecretKey(judge));
}

export async function getKeychainStatus(surface: SurfaceMode): Promise<KeychainStatus> {
  if (surface === 'browser') {
    return {
      service: 'rubric-studio-open',
      backend: 'browser-session-memory',
      allowed_scopes: ['byo-api-keys', 'intake-install-signing-key'],
      stores_user_content: false,
    };
  }
  const invoke = await loadTauriInvoke();
  if (!invoke || window.__TAURI_INTERNALS__ === undefined) {
    return {
      service: 'rubric-studio-open',
      backend: 'desktop-keychain-bridge-unavailable-in-browser-preview',
      allowed_scopes: ['byo-api-keys', 'intake-install-signing-key'],
      stores_user_content: false,
    };
  }
  return invoke<KeychainStatus>('platform_keychain_status');
}

function browserKeychainApi(): PlatformKeychainApi {
  return {
    async set(key, value) {
      sessionStorage.setItem(browserSecretKey(key), value);
    },
    async get(key) {
      return sessionStorage.getItem(browserSecretKey(key));
    },
    async delete(key) {
      sessionStorage.removeItem(browserSecretKey(key));
    },
    async list(service, scope) {
      const prefix = `${browserSecretPrefix}:${service}:${scope}:`;
      return Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith(prefix)))
        .map((key) => key.slice(prefix.length));
    },
  };
}

function tauriKeychainApi(invoke: TauriInvoke): PlatformKeychainApi {
  return {
    async set(key, value) {
      await invoke('platform_keychain_set', { key, value, secret: true });
    },
    async get(key) {
      return invoke<string | null>('platform_keychain_get', { key, secret: true });
    },
    async delete() {
      throw new Error('Rubric Studio Open does not expose install key deletion.');
    },
    async list() {
      return [];
    },
  };
}

function createBrowserIntakeKeypair(): IntakeInstallSigningKeypair {
  const key = intakeInstallSigningKeypairKey('rubric-studio-open');
  return {
    algorithm: 'Ed25519',
    public_key: `${key.service}:${key.identifier}:public`,
    private_key: `${key.service}:${key.identifier}:private`,
    created_at: new Date().toISOString(),
  };
}

async function ensureIntakeInstallSigningKeypair(
  keychain: PlatformKeychainApi,
  service: string,
  createKeypair: () => IntakeInstallSigningKeypair,
): Promise<IntakeInstallSigningKeypair> {
  const key = intakeInstallSigningKeypairKey(service);
  const existing = await keychain.get(key);
  if (existing) {
    return JSON.parse(existing) as IntakeInstallSigningKeypair;
  }
  const next = createKeypair();
  await keychain.set(key, JSON.stringify(next));
  return next;
}

function intakeInstallSigningKeypairKey(service: string): PlatformKeychainKey {
  return {
    service,
    scope: 'intake-install-signing-key',
    identifier: 'auraonepkg-install-signing-key',
  };
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

function browserSecretKey(key: PlatformKeychainKey): string {
  return `${browserSecretPrefix}:${key.service}:${key.scope}:${key.identifier}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(16, '0');
}

import type { SurfaceMode } from './rubric';

export type EnginePluginCapability =
  | 'rubric-validation'
  | 'calibration'
  | 'bias-probe'
  | 'contamination-audit'
  | 'export-adapter'
  | 'judge-scoring'
  | 'semantic-diff';

export type EnginePluginRuntime = 'rust-native' | 'python-sidecar' | 'wasm' | 'node-sidecar';
export type EnginePluginTrustLevel = 'built-in' | 'verified-community' | 'community-review';
export type EnginePluginInstallState = 'installed' | 'available' | 'blocked';

export interface EnginePluginSandboxPolicy {
  runtime: EnginePluginRuntime;
  requiresDesktop: boolean;
  networkAccess: 'none' | 'explicit-provider' | 'declared-endpoints';
  fileSystem: 'none' | 'project-read' | 'project-read-write';
  sendsUserContent: boolean;
  unsignedCode: boolean;
}

export interface EnginePluginListing {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: 'MIT' | 'Apache-2.0' | 'BSD-3-Clause';
  homepage: string;
  engineLibrary: string;
  capabilities: EnginePluginCapability[];
  trustLevel: EnginePluginTrustLevel;
  installState: EnginePluginInstallState;
  manifestSha256: string;
  sandbox: EnginePluginSandboxPolicy;
  blockedReason?: string;
}

export interface EnginePluginCompatibility {
  pluginId: string;
  compatible: boolean;
  status: EnginePluginInstallState;
  message: string;
}

export interface EnginePluginCatalogSummary {
  total: number;
  installed: number;
  available: number;
  blocked: number;
  browserCompatible: number;
  desktopOnly: number;
  sendsUserContent: number;
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedLicenses = new Set<EnginePluginListing['license']>(['MIT', 'Apache-2.0', 'BSD-3-Clause']);

export const enginePluginCatalog: EnginePluginListing[] = [
  {
    id: 'rubric-spec-validator',
    name: 'rubric-spec validator',
    version: '1.0.0',
    description: 'Built-in rubric-spec v1 validation, quick fixes, and conformance badge metadata.',
    author: 'AuraOne Open',
    license: 'MIT',
    homepage: 'https://github.com/auraoneai/rubric-studio-open',
    engineLibrary: 'rubric-spec',
    capabilities: ['rubric-validation', 'export-adapter'],
    trustLevel: 'built-in',
    installState: 'installed',
    manifestSha256: '7b9d4d9c3a5ef01e4e74f07cb7fb2c404871a0ec15d7df38f822ac39fa6a41ef',
    sandbox: {
      runtime: 'rust-native',
      requiresDesktop: false,
      networkAccess: 'none',
      fileSystem: 'project-read-write',
      sendsUserContent: false,
      unsignedCode: false,
    },
  },
  {
    id: 'iaa-kit-calibration',
    name: 'iaa-kit calibration',
    version: '1.0.0',
    description: 'Desktop sidecar for agreement metrics, hierarchical IAA, and latent calibration classes.',
    author: 'AuraOne Open',
    license: 'MIT',
    homepage: 'https://github.com/auraoneai/iaa-kit',
    engineLibrary: 'iaa-kit',
    capabilities: ['calibration'],
    trustLevel: 'built-in',
    installState: 'installed',
    manifestSha256: '8ef3c2606b676f4b2746b3e1d15e8b6e05b083d9c7b1a8cdd351f2f0e013c25a',
    sandbox: {
      runtime: 'python-sidecar',
      requiresDesktop: true,
      networkAccess: 'none',
      fileSystem: 'project-read',
      sendsUserContent: false,
      unsignedCode: false,
    },
  },
  {
    id: 'judge-bench-probes',
    name: 'judge-bench probes',
    version: '1.0.0',
    description: 'Bias, position, formatting, and refusal-probe runner for local judge calibration.',
    author: 'AuraOne Open',
    license: 'MIT',
    homepage: 'https://github.com/auraoneai/judge-bench',
    engineLibrary: 'judge-bench',
    capabilities: ['bias-probe', 'judge-scoring'],
    trustLevel: 'built-in',
    installState: 'installed',
    manifestSha256: '5d9865a07e4a4d71df4b1aa73f6f0ae14fe2f1e1f2b401f4d063a26e12dfe9c0',
    sandbox: {
      runtime: 'python-sidecar',
      requiresDesktop: true,
      networkAccess: 'none',
      fileSystem: 'project-read',
      sendsUserContent: false,
      unsignedCode: false,
    },
  },
  {
    id: 'inspect-export-adapter',
    name: 'Inspect export adapter',
    version: '0.4.0',
    description: 'Community-reviewed adapter manifest for generating AISI Inspect task scaffolds.',
    author: 'Open eval community',
    license: 'MIT',
    homepage: 'https://inspect.ai-safety-institute.org.uk/',
    engineLibrary: 'eval-adapter',
    capabilities: ['export-adapter'],
    trustLevel: 'verified-community',
    installState: 'available',
    manifestSha256: 'f2bb2f0cf9a79e2ef7768ace0f3c5143acdb1013b7ab22e8b9fb7f7cc4b51e81',
    sandbox: {
      runtime: 'wasm',
      requiresDesktop: false,
      networkAccess: 'none',
      fileSystem: 'project-read',
      sendsUserContent: false,
      unsignedCode: false,
    },
  },
  {
    id: 'unsafe-remote-runner',
    name: 'Unsigned remote runner',
    version: '0.0.0',
    description: 'Example blocked plugin showing the OSS trust boundary for unsigned remote execution.',
    author: 'Unknown publisher',
    license: 'MIT',
    homepage: 'https://example.invalid/rubric-plugin',
    engineLibrary: 'third-party',
    capabilities: ['judge-scoring'],
    trustLevel: 'community-review',
    installState: 'blocked',
    manifestSha256: '1b5824f2aa91d8a12dbd8a20a84bbfdc8efbdb213b43d9a9f2d25035c6d28e5a',
    blockedReason: 'Unsigned plugins that declare remote execution are blocked until a maintainer review signs the manifest.',
    sandbox: {
      runtime: 'node-sidecar',
      requiresDesktop: true,
      networkAccess: 'declared-endpoints',
      fileSystem: 'project-read-write',
      sendsUserContent: true,
      unsignedCode: true,
    },
  },
];

export function validateEnginePluginManifest(plugin: EnginePluginListing): string[] {
  const errors: string[] = [];
  if (!pluginIdPattern.test(plugin.id)) {
    errors.push('Plugin id must be lowercase kebab-case.');
  }
  if (!plugin.name.trim()) {
    errors.push('Plugin name is required.');
  }
  if (!sha256Pattern.test(plugin.manifestSha256)) {
    errors.push('Manifest sha256 must be a lowercase 64-character hex digest.');
  }
  if (!allowedLicenses.has(plugin.license)) {
    errors.push('Plugin license must be MIT, Apache-2.0, or BSD-3-Clause.');
  }
  if (plugin.capabilities.length === 0) {
    errors.push('At least one engine capability is required.');
  }
  if (plugin.sandbox.sendsUserContent && plugin.trustLevel !== 'built-in' && plugin.installState !== 'blocked') {
    errors.push('Community plugins that send user-authored rubric content must stay blocked.');
  }
  if (plugin.sandbox.unsignedCode && plugin.installState !== 'blocked') {
    errors.push('Unsigned plugin code must stay blocked until a signed manifest exists.');
  }
  if (plugin.sandbox.networkAccess === 'declared-endpoints' && plugin.installState !== 'blocked') {
    errors.push('Declared-endpoint plugins require maintainer review before installation.');
  }
  return errors;
}

export function enginePluginCompatibility(
  plugin: EnginePluginListing,
  surface: SurfaceMode,
): EnginePluginCompatibility {
  const errors = validateEnginePluginManifest(plugin);
  if (errors.length > 0) {
    return {
      pluginId: plugin.id,
      compatible: false,
      status: 'blocked',
      message: errors[0],
    };
  }
  if (plugin.installState === 'blocked') {
    return {
      pluginId: plugin.id,
      compatible: false,
      status: 'blocked',
      message: plugin.blockedReason ?? 'Plugin is blocked by the local trust policy.',
    };
  }
  if (surface === 'browser' && plugin.sandbox.requiresDesktop) {
    return {
      pluginId: plugin.id,
      compatible: false,
      status: 'blocked',
      message: 'Desktop-only sidecar plugins are disabled in Browser Edition.',
    };
  }
  return {
    pluginId: plugin.id,
    compatible: true,
    status: plugin.installState,
    message: plugin.installState === 'installed' ? 'Installed in the local engine runtime.' : 'Available after signed manifest review.',
  };
}

export function summarizeEnginePluginCatalog(
  plugins: EnginePluginListing[],
  surface: SurfaceMode,
): EnginePluginCatalogSummary {
  return plugins.reduce<EnginePluginCatalogSummary>(
    (summary, plugin) => {
      const compatibility = enginePluginCompatibility(plugin, surface);
      summary.total += 1;
      summary[compatibility.status] += 1;
      if (plugin.sandbox.requiresDesktop) {
        summary.desktopOnly += 1;
      } else {
        summary.browserCompatible += 1;
      }
      if (plugin.sandbox.sendsUserContent) {
        summary.sendsUserContent += 1;
      }
      return summary;
    },
    {
      total: 0,
      installed: 0,
      available: 0,
      blocked: 0,
      browserCompatible: 0,
      desktopOnly: 0,
      sendsUserContent: 0,
    },
  );
}

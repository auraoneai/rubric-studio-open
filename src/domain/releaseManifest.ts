export type ReleaseArtifact = {
  platform: 'macos' | 'windows' | 'linux' | 'vscode' | 'web';
  architecture?: string;
  format: string;
  url: string;
  sha256?: string;
  verified: boolean;
};

export type RubricReleaseManifest = {
  product: 'rubric-studio-open';
  version: string;
  publishedAt: string;
  releaseUrl: string;
  artifacts: ReleaseArtifact[];
};

export type ReleaseAvailability =
  | { status: 'loading'; releaseUrl: string }
  | { status: 'available'; manifest: RubricReleaseManifest; artifact: ReleaseArtifact }
  | { status: 'unavailable'; releaseUrl: string; reason: string };

const DEFAULT_MANIFEST_URL = 'https://rubric-studio.auraone.ai/release-manifest.json';
export const RUBRIC_RELEASES_URL = 'https://github.com/auraoneai/rubric-studio-open/releases/latest';

export async function loadRubricRelease(
  fetcher: typeof fetch = fetch,
  manifestUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_RUBRIC_RELEASE_MANIFEST_URL || DEFAULT_MANIFEST_URL,
): Promise<ReleaseAvailability> {
  try {
    const response = await fetcher(manifestUrl, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return {
        status: 'unavailable',
        releaseUrl: RUBRIC_RELEASES_URL,
        reason: `Release metadata returned HTTP ${response.status}.`,
      };
    }
    const manifest = await response.json() as unknown;
    if (!isReleaseManifest(manifest)) {
      return {
        status: 'unavailable',
        releaseUrl: RUBRIC_RELEASES_URL,
        reason: 'Release metadata did not match the Rubric Studio Open schema.',
      };
    }
    const artifact = preferredArtifact(manifest.artifacts);
    if (!artifact) {
      return {
        status: 'unavailable',
        releaseUrl: manifest.releaseUrl,
        reason: 'No verified desktop artifact is listed for this platform.',
      };
    }
    return { status: 'available', manifest, artifact };
  } catch (error) {
    return {
      status: 'unavailable',
      releaseUrl: RUBRIC_RELEASES_URL,
      reason: error instanceof Error ? error.message : 'Release metadata could not be loaded.',
    };
  }
}

function preferredArtifact(artifacts: ReleaseArtifact[]): ReleaseArtifact | undefined {
  const platform = navigatorPlatform();
  return artifacts.find((artifact) => artifact.platform === platform && artifact.verified)
    ?? artifacts.find((artifact) => artifact.platform === 'macos' && artifact.verified)
    ?? artifacts.find((artifact) => artifact.verified);
}

function navigatorPlatform(): ReleaseArtifact['platform'] {
  if (typeof navigator === 'undefined') return 'macos';
  const platform = navigator.userAgent.toLowerCase();
  if (platform.includes('windows')) return 'windows';
  if (platform.includes('linux')) return 'linux';
  return 'macos';
}

function isReleaseManifest(value: unknown): value is RubricReleaseManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<RubricReleaseManifest>;
  return manifest.product === 'rubric-studio-open'
    && typeof manifest.version === 'string'
    && typeof manifest.publishedAt === 'string'
    && isHttpsUrl(manifest.releaseUrl)
    && Array.isArray(manifest.artifacts)
    && manifest.artifacts.every(isArtifact);
}

function isArtifact(value: unknown): value is ReleaseArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<ReleaseArtifact>;
  return ['macos', 'windows', 'linux', 'vscode', 'web'].includes(String(artifact.platform))
    && typeof artifact.format === 'string'
    && isHttpsUrl(artifact.url)
    && typeof artifact.verified === 'boolean';
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

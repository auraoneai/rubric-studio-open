import type { RubricProject } from './rubric';

export interface EvidencePackageScope {
  reviewers: number;
  turnaround: string;
}

export interface EvidencePackageReceipt {
  blob: Blob;
  filename: string;
  manifest: EvidencePackageManifest;
}

export interface EvidencePackageManifest {
  schemaVersion: 'rubric-studio-evidence.v1';
  product: 'rubric-studio-open';
  createdAt: string;
  project: {
    id: string;
    name: string;
    version: string;
    criteria: number;
    samples: number;
  };
  reviewScope: EvidencePackageScope;
  signed: false;
  signature: null;
  signingStatus: 'unavailable-in-this-build';
  privacy: {
    sendsApiKeys: false;
    sendsUserAuthoredContent: false;
    destination: 'local-download';
  };
  artifacts: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
}

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

export async function buildUnsignedEvidencePackage(
  project: RubricProject,
  artifacts: Record<string, string>,
  scope: EvidencePackageScope,
): Promise<EvidencePackageReceipt> {
  const createdAt = new Date().toISOString();
  const encoder = new TextEncoder();
  const packageRoot = safeArchiveSegment(project.id || 'rubric-project');
  const projectBundle = JSON.stringify(
    {
      schema: 'https://spec.auraone.ai/rubric-studio-open/project-bundle/v1',
      exportedAt: createdAt,
      project,
    },
    null,
    2,
  );
  const goldJsonl = project.samples
    .map((sample) =>
      JSON.stringify({
        sampleId: sample.id,
        scores: sample.goldScores,
      }),
    )
    .join('\n');
  const sourceEntries: ZipEntry[] = [
    {
      path: `${packageRoot}/project/project-bundle.json`,
      bytes: encoder.encode(projectBundle),
    },
    {
      path: `${packageRoot}/samples/expert-gold.jsonl`,
      bytes: encoder.encode(goldJsonl ? `${goldJsonl}\n` : ''),
    },
    ...Object.entries(artifacts).map(([name, content]) => ({
      path: `${packageRoot}/artifacts/${safeArchivePath(name)}`,
      bytes: encoder.encode(content),
    })),
  ];
  const artifactRecords = await Promise.all(
    sourceEntries.map(async (entry) => ({
      path: entry.path,
      bytes: entry.bytes.byteLength,
      sha256: await sha256(entry.bytes),
    })),
  );
  const manifest: EvidencePackageManifest = {
    schemaVersion: 'rubric-studio-evidence.v1',
    product: 'rubric-studio-open',
    createdAt,
    project: {
      id: project.id,
      name: project.name,
      version: project.version,
      criteria: project.criteria.length,
      samples: project.samples.length,
    },
    reviewScope: scope,
    signed: false,
    signature: null,
    signingStatus: 'unavailable-in-this-build',
    privacy: {
      sendsApiKeys: false,
      sendsUserAuthoredContent: false,
      destination: 'local-download',
    },
    artifacts: artifactRecords,
  };
  const entries = [
    {
      path: `${packageRoot}/manifest.json`,
      bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    },
    ...sourceEntries,
  ];
  const zip = createStoredZip(entries, new Date(createdAt));
  return {
    blob: new Blob([arrayBufferCopy(zip)], { type: 'application/zip' }),
    filename: `${packageRoot}.rubric-evidence.zip`,
    manifest,
  };
}

export function createStoredZip(entries: ZipEntry[], modifiedAt = new Date()): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(modifiedAt);

  for (const entry of entries) {
    const name = new TextEncoder().encode(safeArchivePath(entry.path));
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.bytes.byteLength, true);
    localView.setUint32(22, entry.bytes.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.byteLength);
    localParts.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.bytes.byteLength, true);
    centralView.setUint32(24, entry.bytes.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto SHA-256 is unavailable; evidence package checksums cannot be created.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBufferCopy(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeArchivePath(value: string): string {
  const segments = value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(safeArchiveSegment);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe evidence package path: ${value}`);
  }
  return segments.join('/');
}

function safeArchiveSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'artifact';
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

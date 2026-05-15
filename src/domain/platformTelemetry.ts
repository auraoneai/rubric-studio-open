export interface TelemetryEvent {
  event_id: string;
  event_name: string;
  timestamp: string;
  session_id: string;
  app: {
    flagship: string;
    version: string;
    channel: string;
  };
  device: {
    install_id: string;
    os: "darwin" | "windows" | "linux";
    os_version: string;
    arch: "x86_64" | "aarch64";
  };
  payload: Record<string, string | number | boolean>;
}

export interface TelemetryLogEntry {
  event: TelemetryEvent;
  recorded_at: string;
  status: "sent" | "local";
  validation: {
    valid: boolean;
    errors: string[];
  };
}

export interface AuraTelemetryEvent {
  id: string;
  name: string;
  timestamp: string;
  optedIn: boolean;
  destination: string;
  payloadPreview: Record<string, unknown>;
}

export class TelemetryEventLog {
  #entries: TelemetryLogEntry[] = [];

  record(event: TelemetryEvent, optedIn: boolean): TelemetryLogEntry {
    const validation = validateTelemetryEvent(event);
    const entry: TelemetryLogEntry = {
      event,
      recorded_at: new Date().toISOString(),
      status: optedIn && validation.valid ? "sent" : "local",
      validation,
    };
    this.#entries.push(entry);
    return entry;
  }

  list(): TelemetryLogEntry[] {
    return [...this.#entries];
  }
}

const installId = "123e4567-e89b-42d3-a456-426614174000";
const sessionId = "123e4567-e89b-42d3-a456-426614174001";

export function createRubricPlatformTelemetryEvent(
  featureId: string,
  payload: Record<string, string | number | boolean>,
): TelemetryEvent {
  return {
    event_name: "feature_used",
    event_id: createUuid(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    app: { flagship: "rubric-studio-open", version: "0.1.0", channel: "stable" },
    device: {
      install_id: installId,
      os: platformOs(),
      os_version: navigator.platform || "unknown",
      arch: platformArch(),
    },
    payload: {
      feature_id: normalizeFeatureId(featureId),
      ...payload,
    },
  };
}

export function toAuraTelemetryEvents(entries: readonly TelemetryLogEntry[]): AuraTelemetryEvent[] {
  return entries.map((entry) => ({
    id: entry.event.event_id,
    name: entry.event.event_name,
    timestamp: entry.recorded_at,
    optedIn: entry.status === "sent",
    destination: entry.status === "sent" ? "telemetry" : "local",
    payloadPreview: {
      validation: entry.validation.valid ? "valid" : entry.validation.errors,
      ...entry.event.payload,
    },
  }));
}

function normalizeFeatureId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 64);
}

function platformOs(): "darwin" | "windows" | "linux" {
  const value = navigator.platform.toLowerCase();
  if (value.includes("mac")) return "darwin";
  if (value.includes("win")) return "windows";
  return "linux";
}

function platformArch(): "x86_64" | "aarch64" {
  const value = navigator.userAgent.toLowerCase();
  return value.includes("arm") || value.includes("aarch64") ? "aarch64" : "x86_64";
}

function createUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "123e4567-e89b-42d3-a456-426614174002";
}

function validateTelemetryEvent(event: TelemetryEvent): TelemetryLogEntry["validation"] {
  const errors = [
    event.event_id ? "" : "event_id is required",
    event.event_name ? "" : "event_name is required",
    event.timestamp ? "" : "timestamp is required",
    event.session_id ? "" : "session_id is required",
    event.app?.flagship === "rubric-studio-open" ? "" : "flagship must be rubric-studio-open",
  ].filter(Boolean);
  return { valid: errors.length === 0, errors };
}

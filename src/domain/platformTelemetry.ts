import type { AuraTelemetryEvent } from "@auraone/aura-ide-kit";
import {
  TelemetryEventLog,
  createTelemetryEvent,
  type TelemetryLogEntry,
  type TelemetryLogStatus,
  type TelemetryEvent,
} from "@auraone/platform-contracts";

export { TelemetryEventLog };
export type { TelemetryEvent, TelemetryLogEntry, TelemetryLogStatus };

const installId = "123e4567-e89b-42d3-a456-426614174000";
const sessionId = "123e4567-e89b-42d3-a456-426614174001";

export function createRubricPlatformTelemetryEvent(
  featureId: string,
  payload: Record<string, string | number | boolean>,
): TelemetryEvent {
  return createTelemetryEvent({
    eventName: "feature_used",
    eventId: createUuid(),
    timestamp: new Date().toISOString(),
    sessionId,
    app: { flagship: "rubric-studio-open", version: "0.2.0", channel: "stable" },
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
  });
}

export function toAuraTelemetryEvents(
  entries: readonly TelemetryLogEntry[],
): AuraTelemetryEvent[] {
  return entries.map((entry) => ({
    id: entry.event.event_id,
    name: entry.event.event_name,
    timestamp: entry.recorded_at,
    optedIn: entry.status === "local_preview",
    destination: "local",
    deliveryStatus: entry.status,
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

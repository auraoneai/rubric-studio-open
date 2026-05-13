# Rubric Studio Open Privacy

Rubric Studio Open is local-first. Rubric files, criteria, samples, judge
prompts, API keys, calibration sets, and exports stay on the user's machine
unless the user explicitly chooses an action that sends or packages data.

## Browser Edition

The browser edition runs without a Python sidecar or native file-system access.
Projects are imported and exported through local browser file APIs. BYO provider
keys are held in session memory for direct provider calls and are never written
to rubric project files.

## Desktop Edition

The desktop edition uses the OS keychain bridge for BYO provider keys. The
keychain scope is limited to `byo-api-keys`; user-authored rubric content,
samples, judge prompts, and export payloads are not stored as secrets.

## Telemetry

Telemetry is off by default. When the user opts in, Rubric Studio Open may log
anonymous install/session metadata, feature usage counts, surface mode, version,
and error categories. Telemetry must not include rubric content, samples, judge
prompts, provider API keys, or local file paths.

Users can inspect the in-app transparent event log before enabling telemetry.

## Crash Reporting

Crash reporting is off by default. When enabled, crash reports use the shared
Open Studio Platform scrubbers for paths, hostnames, and API-key-like strings.
Crash reports must not include rubric content, samples, judge prompts, or
provider API keys.

## Updates

The desktop updater checks signed AuraOne update endpoints. Update checks use
the app version, target, architecture, and selected channel. The browser edition
cannot install desktop updates and reports the update action as unavailable.

## AuraOne Intake Export

The AuraOne intake export is explicit. It produces a local `.auraonepkg`
manifest containing only the rubric, calibration set, judge card, and run
manifest selected for export. Intake export never includes provider API keys,
and user-authored content is sent only after the user confirms the export
destination.

## Local Provider Calls

OpenAI, Anthropic, Google, and local Ollama calls are user-configured. Remote
provider calls go directly from the user's environment to the selected provider
using the user's BYO key. Ollama stays on `localhost:11434`.

## Contact

Security and privacy reports should follow `SECURITY.md`.

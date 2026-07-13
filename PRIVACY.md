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

The desktop edition uses the shared Open Studio Platform OS keychain bridge for
BYO provider keys and the generated Ed25519 intake install signing identity.
Storage is limited to `byo-api-keys` and `intake-install-signing-key`; the
signing scope accepts only the shared `ed25519-install-keypair-v1` identity.
User-authored rubric content, samples, judge prompts, and export payloads are
not stored as secrets.

## Telemetry

Telemetry is off by default. This build exposes only a local telemetry preview;
no network telemetry uploader is implemented. When the user opts into the
preview, Rubric Studio Open may log anonymous install/session metadata, feature
usage counts, surface mode, version, and error categories on the local device.
Preview records use `local_preview`; consent-disabled records use `would_send`.
Neither status means uploaded. Telemetry preview must not include rubric
content, samples, judge prompts, provider API keys, or local file paths.

Users can inspect the in-app local event preview before enabling it.

## Crash Reporting

Crash reporting is off by default. When enabled, crash reports use the shared
Open Studio Platform scrubbers for paths, hostnames, and API-key-like strings.
Crash reports must not include rubric content, samples, judge prompts, or
provider API keys.

## Updates

The desktop updater checks signed AuraOne update endpoints. Update checks use
the app version, target, architecture, and selected channel. The browser edition
cannot install desktop updates and reports the update action as unavailable.

## Local Evidence Export

Evidence export is explicit and local. It produces an unsigned ZIP containing a
project bundle, imported gold labels, generated adapters, a manifest, and
SHA-256 checksums. The package never includes provider API keys. Rubric Studio
Open does not upload the archive, assign reviewers, or claim a cryptographic
signature was created.

## Local Provider Calls

OpenAI, Anthropic, Google, and local Ollama calls are user-configured. Remote
provider calls go directly from the user's environment to the selected provider
using the user's BYO key. Ollama stays on `localhost:11434`.

## Contact

Security and privacy reports should follow `SECURITY.md`.

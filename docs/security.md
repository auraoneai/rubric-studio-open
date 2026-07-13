# Security

Rubric Studio Open is designed for researchers who will inspect network behavior, project files, and exported artifacts.

## Defaults

- Telemetry off by default.
- Crash reporting off by default.
- Local project files by default.
- API keys stored in OS keychain, never plaintext project files.
- Intake export requires explicit preview and confirmation.
- No-network mode is documented and testable.

## Network destinations

The app may contact these destinations only when the relevant feature is enabled:

| Destination | Purpose | Default |
| --- | --- | --- |
| Model provider endpoint | BYO model scoring | Off until key configured |
| `updates.auraone.ai` | Signed update checks | Release-channel dependent |
| `o.auraone.ai/v1/events` | Reserved telemetry endpoint; no uploader is implemented in this build | Unused |
| Sentry project endpoint | Opt-in crash reporting | Off |
| `intake.auraone.ai/v1/packets/` | Explicit AuraOne intake export | Off |

## Security review checklist

- Threat model published before GA.
- Outbound destinations documented.
- Telemetry payloads schema-validated and PII-reviewed.
- No-network mode verified.
- Keychain integration verified per OS.
- Intake packet preview and redaction verified.
- Tauri command ACL reviewed.
- Dependency and license audit completed.

Report issues to `security@auraone.ai`.

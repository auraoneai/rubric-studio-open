# Security

Please report suspected vulnerabilities privately to `security@auraone.ai`.

Do not include API keys, proprietary rubrics, private samples, or confidential
customer data in a public issue.

## Security posture

- Telemetry is opt-in.
- API keys are never included in intake exports.
- Browser edition provider calls use user-supplied keys directly and are not
  proxied through AuraOne.
- Desktop key storage is routed through the shared Open Studio Platform keychain
  bridge.
- AuraOne intake export is explicit user action only.

## Permission review

Rubric Studio Open's tracked Tauri capability manifest currently requests:

| Permission | Purpose | Review decision |
|---|---|---|
| `core:default` | Required Tauri core window/runtime behavior. | Approved as base desktop shell permission. |
| `dialog:default` | User-selected rubric/project file and folder prompts. | Approved only for explicit user selection. |
| `deep-link:default` | Handles `auraone://rubric-studio/open` links. | Approved for desktop handoff and docs flows. |
| `updater:default` | Checks signed platform update manifests. | Approved only with signed-manifest verification. |

The capability manifest intentionally does not grant shell execution, arbitrary
filesystem scope, clipboard manager, process control, or network permissions
beyond the reviewed CSP destinations.

## Network destinations

The desktop CSP currently allows:

| Destination | Purpose | Default |
|---|---|---|
| `http://localhost:11434` | Local Ollama/BYO model scoring. | User-configured. |
| `https://api.openai.com` | BYO OpenAI scoring. | Off until key configured. |
| `https://api.anthropic.com` | BYO Anthropic scoring. | Off until key configured. |
| `https://generativelanguage.googleapis.com` | BYO Google scoring. | Off until key configured. |
| `https://huggingface.co` | Hugging Face export/model integration. | User-initiated. |
| `https://updates.auraone.ai`, `https://updates2.auraone.ai` | Signed update checks. | Release-channel dependent. |
| `https://intake.auraone.ai` | Explicit AuraOne intake export. | Off until user sends. |
| `https://o.auraone.ai` | Reserved telemetry endpoint; no uploader is implemented in this build. | Unused. |
| `https://sentry.io` | Opt-in crash reporting. | Off by default. |

## Supported versions

The initial supported line is `0.1.x`.

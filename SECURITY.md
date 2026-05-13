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

## Supported versions

The initial supported line is `0.1.x`.

# Reference: Project Configuration

`rubric.toml` is the project root configuration.

```toml
name = "medical-advice-safety"
version = "0.1.0"
schema = "rubric-spec/v1"
default_judge = "mock"
no_network = false

[paths]
criteria = "criteria"
samples = "samples"
calibration = "calibration"
exports = "exports"

[telemetry]
enabled = false
local_log = true

[intake]
endpoint = "https://intake.auraone.ai/v1/packets/"
include_samples_by_default = false
```

## Rules

- The app never writes API keys to `rubric.toml`.
- Paths are project-relative.
- Export adapters may add files under `exports/`, but they must not mutate source criteria.
- `no_network = true` disables model-provider calls, telemetry upload, crash upload, update checks, and intake upload.

# Telemetry

Rubric Studio Open telemetry preview is opt-in only. The app must be useful
with telemetry preview disabled.

No network uploader is implemented in this build. Opted-in events are retained
locally with status `local_preview`; opted-out events recorded for consent
transparency use status `would_send`. Neither status means an event was
uploaded.

## Events

Planned event names:

| Event | Purpose | Contains content? |
| --- | --- | --- |
| `app_launched` | Count active installs | No |
| `project_opened` | Understand workflow activation | No project path or content |
| `first_score_completed` | Measure time to first value | No samples or scores |
| `export_completed` | Understand adapter use | Adapter name only |
| `intake_packet_created` | Funnel attribution | Packet metadata only |
| `telemetry_settings_changed` | Audit consent state | No |

## Forbidden fields

Telemetry must never include prompt text, response text, criterion text, reviewer names, local file paths, API keys, raw sample IDs, or customer identifiers.

## Event log

The app includes a privacy panel that shows the local event preview for the
current session. The log clearly distinguishes `local_preview` from
`would_send`, always reports the destination as local, and never claims an
event was sent. Users can inspect the JSON or disable the preview.

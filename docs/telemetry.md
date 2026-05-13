# Telemetry

Rubric Studio Open telemetry is opt-in only. The app must be useful with telemetry disabled.

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

The app includes a privacy panel that shows every event that has been sent or would have been sent during the current session. Users can export the log to JSON, clear the queue, or disable telemetry.

# Architecture

Rubric Studio Open inherits the AuraOne Open Studio Platform.

```text
React / AuraGlass IDE surface
  command palette, criterion tree, editor, preview, calibration, diff, export
        |
Tauri IPC commands and events
        |
Rust core
  project IO, validation hot path, git diff, keychain, telemetry sink, intake writer
        |
Python sidecars
  iaa-kit, judge-bench, contamination-audit, eval-adapter, synthetic-disagreement
```

## Project-as-folder model

```text
rubric-project/
  rubric.toml
  criteria/*.toml
  judges/*.toml
  samples/*.jsonl
  calibration/*.csv
  runs/
  exports/
```

## Browser version

The browser editor supports authoring, schema validation, and sample preview with WASM validation. It does not bundle Python sidecar features.

## CLI companion

The CLI provides parity for validation, scoring, calibration, diffing, and export workflows so teams can use Rubric Studio Open in CI.

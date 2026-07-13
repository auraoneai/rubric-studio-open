# Changelog

## 0.2.0 - 2026-07-12

- Migrated the desktop and hosted workbench to the shared light-first Proofline
  contract through the Aura IDE Kit compatibility layer.
- Removed bundled reference fonts and decorative gradient/glass behavior in
  favor of OSS-safe system typography, semantic state colors, compact radii,
  visible focus, and 44 px mobile controls.
- Added responsive authoring, preview, calibration, diff, export, settings,
  first-run, offline, and update-state presentation.
- Replaced the hard-coded macOS download with verified release-manifest
  discovery and a safe GitHub Releases fallback.
- Added SHA-256 export evidence, explicit destinations, privacy receipts, and
  aligned the VS Code webview with the same Proofline token contract.
- Synchronized desktop, Rust core, browser package, telemetry, and VS Code
  extension release versions at `0.2.0`.

## 0.1.0 - 2026-05-13

- Added Rubric Studio Open Tauri scaffold, Rust validation/scoring/diff core,
  React browser/editor surface, and VS Code extension surface.
- Added example local-first rubric project format under
  `examples/helpful-response-evaluation/`.

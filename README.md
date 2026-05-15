# Rubric Studio Open

Rubric Studio Open is a local-first IDE for authoring, validating, previewing,
calibrating, diffing, and exporting criterion-level AI evaluation rubrics.

![30-second demo of Rubric Studio Open authoring, preview, calibration, diff, export, and settings surfaces](docs/demo/rubric-studio-open-30s.gif)

The app is intentionally single-user and file-based. A rubric is a folder on
disk, so it can be reviewed in Git, shipped in CI, and exported into downstream
evaluation runners without a hosted account.

Launch QA assets:
[authoring](docs/demo/screenshots/01-authoring.png),
[preview scoring](docs/demo/screenshots/02-preview-scoring.png),
[calibration](docs/demo/screenshots/03-calibration.png),
[diff](docs/demo/screenshots/04-diff.png),
[export](docs/demo/screenshots/05-export.png), and
[short workflow video](docs/demo/rubric-studio-open-launch-smoke.mp4).

Production captures from `https://rubric-studio.auraone.ai`:
[authoring](docs/demo/production/01-production-authoring.png),
[preview](docs/demo/production/02-production-preview.png),
[calibration](docs/demo/production/03-production-calibration.png),
[diff](docs/demo/production/04-production-diff.png),
[export](docs/demo/production/05-production-export.png), and
[settings](docs/demo/production/06-production-settings.png).

Production docs and website captures:
[docs home](docs/demo/production/07-production-docs-home.png) and
[AuraOne product page](docs/demo/production/08-production-website-page.png).

## Install

Download the verified macOS Apple Silicon DMG from GitHub Releases:

- [Rubric Studio Open v0.1.0 release](https://github.com/auraoneai/rubric-studio-open/releases/tag/v0.1.0)
- [Rubric.Studio.Open_0.1.0_aarch64.dmg](https://github.com/auraoneai/rubric-studio-open/releases/download/v0.1.0/Rubric.Studio.Open_0.1.0_aarch64.dmg)
- SHA-256: `ac3e98745dd9f7aa60fb9a3fc90cbec9df1ac27876db379c461aebb537886fc4`

Or run the browser IDE immediately:

Browser IDE: [rubric-studio.auraone.ai](https://rubric-studio.auraone.ai)

Build from source:

```bash
git clone https://github.com/auraoneai/rubric-studio-open.git
cd rubric-studio-open
pnpm install
pnpm dev
```

Product page: [auraone.ai/open/rubric-studio-open](https://auraone.ai/open/rubric-studio-open)

Docs: [docs.rubricstudio.auraone.ai](https://docs.rubricstudio.auraone.ai) or [local docs](docs/README.md)

Privacy: [local-first privacy and telemetry policy](PRIVACY.md)

Roadmap and RFC process: [public roadmap and maintainer-gated RFCs](docs/roadmap-rfc.md)

## Current surfaces

- Desktop shell: Tauri 2 scaffold with a Rust core in `src-tauri/`.
- Browser editor: Vite/React surface with browser constraints available through
  `?surface=browser`.
- VS Code surface: extension scaffold under `vscode-extension/` with a webview
  editor command, live rubric TOML diagnostics, completions, and quick fixes.

## Run locally

```bash
pnpm dev
```

Open `http://127.0.0.1:5174/?surface=browser` to exercise the browser edition.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm test:readme
pnpm test:privacy
pnpm build
pnpm vscode:contract
pnpm vscode:typecheck
pnpm tauri:core:test
```

## Project format

The example project in `examples/helpful-response-evaluation/` shows the v0
folder layout:

```text
rubric.toml
themes/*.md
criteria/<theme>/*.toml
samples/*.jsonl
judges/*.toml
exports/
.rubric/
```

The TypeScript domain model and Rust validator both enforce the same core
contract: stable criterion IDs, required labels/descriptions, bounded weights,
example guidance, explicit evidence requirements, and deterministic scoring
fixtures.

## Open-source boundary

Rubric Studio Open does not include hosted queues, payments, reviewer workforce
management, multi-tenant RBAC, adjudication operations, or Cloud approval chains.
The only commercial handoff is the explicit export flow labelled "Send to
AuraOne for expert review"; it packages an intake artifact only after user
confirmation.

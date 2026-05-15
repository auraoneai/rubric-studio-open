# Quickstart: Install and Score a Sample

Goal: go from first install to a scored sample and exported manifest in about one minute.

## Prerequisites

- macOS, Windows, or Linux desktop environment.
- Python 3.11+ for the CLI companion.
- No AuraOne account required.
- Optional: OpenAI, Anthropic, Google, or local model key. The quickstart uses the local mock judge.

## Install

Download the verified macOS Apple Silicon DMG:

```text
https://github.com/auraoneai/rubric-studio-open/releases/download/v0.1.0/Rubric.Studio.Open_0.1.0_aarch64.dmg
```

Verify the SHA-256 before opening the app:

```text
ac3e98745dd9f7aa60fb9a3fc90cbec9df1ac27876db379c461aebb537886fc4
```

Or run the browser IDE:

```text
https://rubric-studio.auraone.ai
```

Build from source when you want the latest public repo state:

```bash
git clone https://github.com/auraoneai/rubric-studio-open.git
cd rubric-studio-open
pnpm install
pnpm dev
```

## Create a project

```bash
rubric init behavior-shaping-v1
cd behavior-shaping-v1
```

Project layout:

```text
behavior-shaping-v1/
  rubric.toml
  criteria/
  judges/
  samples/
  calibration/
  exports/
```

## Add the tutorial sample

```bash
rubric sample add --template medical-advice --out samples/medical-advice.jsonl
```

## Validate and score

```bash
rubric validate
rubric score --judge mock --samples samples/medical-advice.jsonl --out runs/first-score
```

Expected output:

```text
rubric-spec: valid
samples: 12
criteria: 9
average_score: 0.84
warnings: 2
```

## Export provenance

```bash
rubric export manifest --run runs/first-score --out exports/eval-run-manifest.json
rubric export judge-card --run runs/first-score --out exports/judge-card.md
```

Next: open the project in the desktop app and inspect the preview, calibration, diff, and export tabs.

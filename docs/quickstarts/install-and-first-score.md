# Quickstart: Open And Score A Sample

Goal: open the verified Rubric Studio Open release, score the bundled sample,
and export evidence in about one minute.

## Prerequisites

- A current desktop browser, or Apple silicon macOS for the desktop release.
- No AuraOne account required.
- Optional: an OpenAI, Anthropic, Google, or local model key. This quickstart
  uses the deterministic local mock judge.

## Open The Studio

Use the [hosted browser editor](https://rubric-studio.auraone.ai), or download
the signed and notarized Apple silicon DMG from the
[Rubric Studio Open 0.2.0 release](https://github.com/auraoneai/rubric-studio-open/releases/tag/v0.2.0).

## Open The Sample

Open the bundled `Helpful response evaluation` project. The Studio starts in
the authoring workflow with criteria, response samples, and a local mock judge
already available.

## Review And Score

1. Open **Preview**.
2. Select a response sample.
3. Run the enabled local mock judge.
4. Inspect the criterion verdicts, confidence, reasoning, and cited evidence.
5. Open **Calibrate** to compare the result with the bundled gold scores.

## Export Evidence

Open **Export**, then download the project bundle or checksummed evidence
archive. The export remains local and does not require an AuraOne account.

## Validate A JSON Bundle

```bash
npx @auraone/rubric-studio@0.2.1 validate ./project-bundle.json
```

The npm companion validates the portable JSON project boundary. It does not
bundle the visual application or run model scoring.

Next: edit a criterion in **Author**, rerun the sample, and inspect its
score-impact change in **Diff** before exporting the revised project.

# Tutorial: Export to lm-eval-harness

Use this adapter when a rubric needs to run inside an existing benchmark or CI workflow powered by `lm-eval-harness`.

## Validate first

```bash
rubric validate
rubric conformance --suite rubric-spec-v1
```

## Export

```bash
rubric export lm-eval-harness \
  --project . \
  --out exports/lm-eval-harness
```

Generated files:

```text
exports/lm-eval-harness/
  task.yaml
  rubric.json
  judge_prompt.txt
  README.md
```

## Check adapter warnings

Not every rubric feature maps perfectly to every eval framework. The exporter writes adapter warnings for unsupported evidence requirements, multi-judge settings, or calibration metadata that must remain in the sidecar manifest.

```bash
rubric export warnings --path exports/lm-eval-harness
```

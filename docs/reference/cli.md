# Reference: CLI Commands

The `rubric` CLI mirrors the desktop app's export and validation workflows.

```text
rubric init <name>
rubric open <path>
rubric validate [--strict]
rubric sample add --template <name> --out <path>
rubric score --judge <mock|openai|anthropic|google|ollama> --samples <path> --out <dir>
rubric calibrate --gold <csv> --samples <jsonl> --out <dir>
rubric diff --base <ref> --head <ref> --out <dir>
rubric diff impact --base-run <dir> --head-run <dir> --out <path>
rubric conformance --suite rubric-spec-v1
rubric export rubric-spec --out <path>
rubric export judge-card --run <dir> --out <path>
rubric export manifest --run <dir> --out <path>
rubric export lm-eval-harness --out <dir>
rubric export inspect --out <dir>
rubric export openai-evals --out <dir>
rubric export promptfoo --out <dir>
rubric export auraone-intake --out <path>
rubric intake send <packet>
```

Every command supports `--no-network` where meaningful. Commands that require network access fail closed when no-network mode is active.

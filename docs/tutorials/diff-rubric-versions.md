# Tutorial: Diff Two Rubric Versions

Rubric diffs need more than line-by-line text changes. A small wording change can shift many scored samples.

## Start from a git branch

```bash
git checkout -b revise-medical-boundaries
```

Edit one or more files in `criteria/`.

## Run semantic diff

```bash
rubric diff --base main --head revise-medical-boundaries --out runs/diff-001
```

The diff report groups changes by:

- Criterion added, removed, or renamed.
- Weight or severity change.
- Boundary wording change.
- Example change.
- Evidence requirement change.
- Theme-tag and sibling-link change.

## Run score-impact overlay

```bash
rubric diff impact \
  --base-run runs/main-score \
  --head-run runs/revised-score \
  --out runs/diff-001/impact.json
```

The app shows every sample that flipped, the criterion most likely responsible, and the before/after rationale. Commit only after the changed behavior is intentional.

# Tutorial: Calibrate Against Expert Scores

Use this workflow when you have a gold set from physicians, lawyers, domain specialists, safety reviewers, or internal expert reviewers.

## Inputs

- `samples/*.jsonl`: prompts and responses.
- `calibration/gold-scores.csv`: expert labels with criterion IDs.
- `criteria/*.toml`: criteria to test.

Gold-score CSV shape:

```csv
sample_id,criterion_id,reviewer_id,score,rationale
r-001,medical.source_grounded_claims,expert-a,pass,"Grounded in the supplied source."
r-001,medical.source_grounded_claims,expert-b,fail,"The dosage sentence overreaches."
```

## Run calibration

```bash
rubric calibrate \
  --gold calibration/gold-scores.csv \
  --samples samples/medical-advice.jsonl \
  --out calibration/run-001
```

Rubric Studio Open surfaces:

- Cohen kappa for two-reviewer slices.
- Fleiss kappa for multi-reviewer sets.
- Krippendorff alpha for missing-label or ordinal cases.
- Bootstrap confidence intervals.
- Criteria ranked by disagreement, severity, and score-impact risk.

## Iterate

Open the calibration tab and inspect the "Which criteria need work" list. Rewrite only the criteria that show weak agreement or unstable boundary examples. Re-run calibration and commit the diff when agreement improves.

## Export

```bash
rubric export calibration-report --run calibration/run-001 --out exports/calibration-report.md
```

The report is suitable for paper supplements, internal safety review, or a Cloud handoff packet.

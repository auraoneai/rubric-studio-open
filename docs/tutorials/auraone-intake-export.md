# Tutorial: Use the AuraOne Intake Export

AuraOne intake export is the clean handoff from Rubric Studio Open to Rubric Studio Cloud, Enterprise, or AuraOne Rubric Programs. It is explicit: the app never sends a packet unless the user previews and confirms it.

## Create the packet

```bash
rubric export auraone-intake \
  --project . \
  --run runs/first-score \
  --out exports/medical-advice-safety.auraonepkg
```

## Preview

The preview lists:

- Project metadata.
- Criteria and examples.
- Calibration summary.
- Exported manifests.
- Redaction report.
- Destination endpoint.

The preview also lists what is never sent:

- API keys.
- Local file paths.
- Unselected sample text.
- Raw private datasets not included by the user.
- Telemetry history.

## Send

```bash
rubric intake send exports/medical-advice-safety.auraonepkg
```

Use this only when the team wants hosted collaboration, expert-review capacity, approval workflows, or managed rubric programs.

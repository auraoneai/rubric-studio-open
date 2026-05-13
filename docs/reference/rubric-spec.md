# Reference: Rubric Spec

Rubric Studio Open stores criteria as structured files that compile to `rubric-spec` v1.

## Required fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable, unique criterion ID. |
| `title` | string | Human-readable criterion title. |
| `weight` | number | Relative score weight from `0` to `1`. |
| `severity` | enum | `low`, `medium`, `high`, `critical`. |
| `evidence_requirement` | enum | `none`, `quote`, `source_citation`, `screenshot`, `test_output`, `reviewer_note`. |
| `pass.description` | string | Boundary for passing behavior. |
| `fail.description` | string | Boundary for failing behavior. |

## Optional fields

- `theme_tags`
- `sibling_links`
- `owner`
- `version`
- `rationale`
- `known_failure_modes`
- `examples`
- `adapter_hints`

## Validation principles

- No duplicate criterion IDs.
- Every high-severity criterion needs at least one pass example and one fail example.
- Evidence requirements must be supported by the target export adapter.
- Weights may be normalized at export time, but the source file preserves author intent.

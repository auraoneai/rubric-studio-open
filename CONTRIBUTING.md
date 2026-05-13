# Contributing

Rubric Studio Open uses the AuraOne Open Studio contributor model: MIT license,
DCO sign-off, and small focused changes.

## Development

```bash
pnpm --filter=@auraone/rubric-studio-open typecheck
pnpm --filter=@auraone/rubric-studio-open test
pnpm --filter=@auraone/rubric-studio-open build
pnpm --filter=@auraone/rubric-studio-open tauri:core:test
```

## DCO

Every commit must include a Signed-off-by trailer:

```text
Signed-off-by: Your Name <you@example.com>
```

This certifies that you have the right to submit the contribution under the
project license.

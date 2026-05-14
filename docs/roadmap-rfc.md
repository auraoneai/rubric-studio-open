# Roadmap And RFC Process

Rubric Studio Open maintains a public roadmap for user-visible product direction
and a maintainer-gated RFC process for changes that alter project formats,
engine contracts, security posture, distribution, or commercial boundaries.

This document is the local source for the public roadmap and RFC process. The
post-launch requirement is not complete until the approved contents are
published in the public repository and maintainers attach the public issue,
discussion, or release evidence requested by the external readiness handoff.

## Roadmap Lanes

| Lane | Scope | Current launch posture | Public evidence required |
| --- | --- | --- | --- |
| Authoring quality | Criterion editor, validation, templates, accessibility, keyboard workflows | Launch surface is active | Public issue labels and triage board |
| Engine interoperability | `rubric-spec`, IAA, judge-bench, EvalKit, conformance adapters | Launch surface is active | Engine compatibility issues and release notes |
| Desktop distribution | Signed macOS, Windows, Linux, update server, clean-machine QA | Blocked on signing and registry evidence | Signed release, installer QA, and update endpoint evidence |
| Browser edition | File System Access workflow, direct BYO-provider calls, no local sidecars | Launch surface is active | Browser support issues and docs feedback |
| OSS community | Discussions, support SLA, community channel, contribution path | Blocked on public seeding and launch ops | Public discussion URLs and moderation log |
| Post-launch P4 | Plugin marketplace, read-only CRDT collaboration, Snap/Flatpak, store distribution, i18n, advanced calibration, advanced diff | Planned after launch feedback | Approved P4 issues/RFCs and release evidence |

## RFC Triggers

Open an RFC before merging changes that do any of the following:

- Change `rubric.toml`, criterion TOML, export bundle, intake packet, or
  `rubric-spec` semantics.
- Add, remove, rename, or materially change an engine-library integration.
- Introduce third-party plugin marketplace behavior.
- Add collaboration, syncing, or remote execution behavior.
- Change telemetry, crash reporting, keychain, update, signing, or security
  behavior.
- Change the OSS/commercial boundary or add a Cloud handoff path.
- Add public distribution channels such as Snap, Flatpak, Microsoft Store, or
  Mac App Store.

Small bug fixes, copy edits, examples, and local-only UI polish can proceed
through normal pull requests when they do not affect these surfaces.

## RFC Lifecycle

1. Draft the proposal with the issue template in
   `.github/ISSUE_TEMPLATE/rfc.md`.
2. Link affected docs, schemas, tests, examples, and public compatibility risks.
3. Maintainers assign one of: `draft`, `needs-data`, `accepted`, `rejected`, or
   `superseded`.
4. Accepted RFCs require at least one maintainer approval and a linked
   implementation issue or pull request.
5. Schema, security, distribution, and OSS/commercial boundary RFCs require an
   explicit compatibility and rollback note before merge.
6. Closed RFCs remain public unless they contain private security, legal, or
   customer information. Sensitive evidence belongs in the external evidence
   folder, not in the public RFC.

## Initial RFC Backlog

| ID | Topic | Trigger | Earliest window | Closure evidence |
| --- | --- | --- | --- | --- |
| RFC-001 | Third-party engine plugin marketplace | New extensibility and trust boundary | P4 after first launch feedback | Plugin manifest spec, sandbox rules, tests, and maintainer approval |
| RFC-002 | Read-only CRDT collaboration | New collaboration/sync behavior | P4 after security review | CRDT data model, privacy review, tests, and rollback plan |
| RFC-003 | Advanced calibration | New hierarchical IAA and latent class workflows | P4 after engine audit | Engine contract, fixtures, docs, and benchmark evidence |
| RFC-004 | Live judge-fleet A/B diff | Hosted execution boundary and Cloud interaction | P4 after intake funnel review | Boundary review, user consent model, and live-fleet test evidence |
| RFC-005 | Standards-body rubric-spec submission | Public standards proposal | 90 days after launch | Feedback summary, draft RFC candidate, and maintainer approval |

## Labels

Public roadmap and RFC issues use these labels:

- `roadmap`: user-visible roadmap item.
- `rfc`: design proposal requiring maintainer decision.
- `needs-data`: blocked on launch telemetry, support evidence, partner feedback,
  or benchmark data.
- `compatibility`: affects file formats, exports, or public APIs.
- `security-review`: affects keys, telemetry, signing, updates, remote calls, or
  sandboxing.
- `oss-boundary`: affects the Open/Cloud/Enterprise separation.

## Non-Public Evidence Rules

Do not commit private user data, customer names, security findings, legal
advice, employee information, credentials, or unpublished partner feedback in
roadmap or RFC issues. Public RFCs may link to redacted evidence summaries. Raw
evidence stays in the controlled evidence store described by
`docs/release/external-readiness.md`.

# Rubric Studio Open

Rubric Studio Open is a local-first IDE for authoring, validating, previewing,
calibrating, diffing, and exporting criterion-level AI evaluation rubrics.

It is built for evaluation engineers, rubric authors, model-quality teams, and
reviewers who want rubric work to stay inspectable as files. The differentiator
is one visual workflow from criterion authoring through scoring evidence,
calibration, semantic diff, and deterministic export, without requiring a
hosted project account.

![Rubric Studio Open reviewer preview with response samples, deterministic local fixture scores, and criterion evidence](https://www.auraone.ai/open/rubric-studio-open/screenshots/preview-scoring.webp)

The app is intentionally single-user and file-based. A rubric is a folder on
disk, so it can be reviewed in Git, shipped in CI, and exported into downstream
evaluation runners without a hosted account.

## Visual Workflow

1. Author stable criterion IDs, labels, descriptions, weights, examples, and
   evidence requirements.
2. Preview held-out responses with deterministic fixture evidence or an
   explicitly invoked BYO provider.
3. Calibrate against gold labels and inspect disagreement at criterion level.
4. Diff rubric revisions with score-impact context instead of raw text alone.
5. Export runner-ready files and a local, checksummed evidence archive.

The selected proof image matches the single product view used by the public
website route. Capture provenance is recorded in the
[AuraFoundry release evidence](https://github.com/gchahal1982/AuraFoundry/blob/main/docs/evidence/final-makeover/assets/open-source-capture-provenance.json).

## Install

### Hosted Browser

Open the Browser editor at
[rubric-studio.auraone.ai](https://rubric-studio.auraone.ai).

### Public Desktop Release

Download the signed and notarized macOS Apple silicon DMG from
[Rubric Studio Open 0.2.0](https://github.com/auraoneai/rubric-studio-open/releases/tag/v0.2.0).
Verify the downloaded artifact before opening it:

```bash
shasum -a 256 Rubric.Studio.Open_0.2.0_aarch64.dmg
# 7dcb7de67835947b421089eab5fc244bcd8f75d503ebc7e763921c229c68f23d
```

Homebrew is not a verified `0.2.0` distribution channel. Use the GitHub Release
or hosted browser for the current release.

### JavaScript Companion

Install the dependency-free project-bundle validator and release metadata API:

```bash
npm install @auraone/rubric-studio@0.2.1
npx @auraone/rubric-studio validate ./project-bundle.json
```

The npm package does not bundle the visual React/Tauri application. Use the
hosted editor, desktop DMG, or source checkout for the full Studio workflow.

### Source Checkout

```bash
git clone https://github.com/auraoneai/rubric-studio-open.git
cd rubric-studio-open
pnpm install
pnpm dev
```

Use Node.js `20.19.5` or newer. The `0.2.0` repository includes the exact
shared AuraOne Open Studio source packages needed by the application, so a
fresh clone installs and runs without a sibling monorepo checkout.

Product page: [auraone.ai/open/rubric-studio-open](https://auraone.ai/open/rubric-studio-open)

Docs: [docs.rubricstudio.auraone.ai](https://docs.rubricstudio.auraone.ai) or [local docs](docs/README.md)

The hosted browser surface never embeds a version-specific installer URL. It
loads `https://rubric-studio.auraone.ai/release-manifest.json`,
offers only artifacts marked `verified`, and otherwise links to the canonical
GitHub Releases page. Development and staging builds can override the manifest
endpoint with `VITE_RUBRIC_RELEASE_MANIFEST_URL`.

Privacy: [local-first privacy and telemetry policy](PRIVACY.md)

Roadmap and RFC process: [public roadmap and maintainer-gated RFCs](docs/roadmap-rfc.md)

## Current Surfaces

- Desktop shell: Tauri 2 scaffold with a Rust core in `src-tauri/`.
- Browser editor: Vite/React surface with browser constraints available through
  `?surface=browser`.
- VS Code surface: extension scaffold under `vscode-extension/` with a webview
  editor command, live rubric TOML diagnostics, completions, and quick fixes.

## Runtime, Data, And Network Boundary

- **Browser data:** projects, checkpoints, preferences, shortcuts, onboarding,
  and recent-project metadata use local browser storage. BYO provider keys are
  session-scoped and are removed with the browser session.
- **Desktop data:** project folders stay on local disk. Provider secrets cross
  the native bridge only through the approved OS-keychain contract.
- **Evaluation network:** mock scoring is local. OpenAI, Anthropic, and Google
  calls occur only after an explicit browser action with a configured BYO key.
  Ollama uses its explicitly configured local endpoint.
- **Product network:** the app may check the release manifest and follow
  documentation/release links. No telemetry uploader is configured; telemetry
  is a local preview and crash reporting is off by default.
- **Exports:** the open-source flow downloads or writes local artifacts and an
  unsigned evidence ZIP. It does not upload project content or start an
  external review workflow.

No-network mode keeps authoring, validation, fixture scoring, diffing, and local
exports available while provider scoring, update checks, and crash upload fail
closed.

## Font Boundary

The public source, browser build, npm metadata, and desktop source archive
contain no private licensed font binary. Proofline uses system sans-serif and
monospace fallbacks by default. The canonical hosted browser loads licensed
AuraOne typography through `/fonts/proofline-brand.css`, a same-origin proxy to
the marketing-site font boundary. If it is absent or blocked, the public system
fallback remains fully supported. Local capture tooling may use an isolated
temporary loopback font boundary, but those binaries are never copied into
public packages or release artifacts.

## Run Locally

```bash
pnpm dev
```

Open `http://127.0.0.1:5174/?surface=browser` to exercise the browser edition.

## Proof And Verification

```bash
pnpm typecheck
pnpm test
pnpm test:readme
pnpm test:privacy
pnpm test:design
pnpm build
pnpm vscode:contract
pnpm vscode:typecheck
pnpm tauri:core:test
pnpm test:capture-evidence
```

The TypeScript/Rust contract tests verify deterministic scoring and validation.
The README, privacy, design, VS Code, accessibility, geometry, and browser
suites cover the public entry points and workflow behavior.

The July 13, 2026 capture manifest preserves the original local-render
provenance. Public availability is established separately by the pushed release
commit, GitHub Release asset, checksum, notarization record, and production
browser deployment.

## Release Truth

Status verified on **July 13, 2026**:

- GitHub Release `rubric-studio-open-v0.2.0` is public.
- `Rubric.Studio.Open_0.2.0_aarch64.dmg` is signed, notarized, stapled,
  Gatekeeper accepted, checksum verified, and offline-install tested.
- The hosted Browser editor is publicly reachable and was visually reverified
  after the final 1440 px toolbar-fit correction.
- `@auraone/rubric-studio@0.2.1` is live on npm as the dependency-free
  JavaScript validator, CLI, and release metadata companion. It does not bundle
  the visual application.
- Homebrew, Windows, Linux, and automatic updater channels are not published
  for `0.2.0`.

## Project Format

The example project in `examples/helpful-response-evaluation/` shows the v0
folder layout:

```text
rubric.toml
themes/*.md
criteria/<theme>/*.toml
samples/*.jsonl
judges/*.toml
exports/
.rubric/
```

The TypeScript domain model and Rust validator both enforce the same core
contract: stable criterion IDs, required labels/descriptions, bounded weights,
example guidance, explicit evidence requirements, and deterministic scoring
fixtures.

## Open-source boundary

Rubric Studio Open does not include hosted queues, payments, reviewer workforce
management, multi-tenant RBAC, adjudication operations, or Cloud approval chains.
The export flow creates local artifacts and an explicitly unsigned evidence ZIP.
It does not assign reviewers, upload project content, create a signature, or
claim that an external workflow has started.

## Next Action

Use the hosted Browser editor or the verified `0.2.0` GitHub DMG for released
behavior. Contributors should run the proof commands and include a
non-sensitive fixture for behavioral changes. Treat Homebrew, Windows, Linux,
and automatic updater paths as unavailable until destination-specific evidence
is published.

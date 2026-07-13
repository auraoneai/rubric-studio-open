# Rubric Studio Open Release Status

Status verified on **July 13, 2026**.

Rubric Studio Open `0.2.0` is publicly available through the hosted browser
editor and the signed macOS Apple silicon DMG. This page records the supported
release paths and the channels that remain intentionally unavailable.

## Published Channels

| Channel | Status | Evidence |
| --- | --- | --- |
| Browser editor | Live | `https://rubric-studio.auraone.ai` |
| GitHub Release | Live | `rubric-studio-open-v0.2.0` |
| macOS Apple silicon DMG | Live | `Rubric.Studio.Open_0.2.0_aarch64.dmg` |
| npm companion | Live | `@auraone/rubric-studio@0.2.0` |
| Source | Live | AuraFoundry release tag and public source repository |
| Documentation | Live | `https://docs.rubricstudio.auraone.ai` and this docs tree |

The public DMG has SHA-256:

```text
7dcb7de67835947b421089eab5fc244bcd8f75d503ebc7e763921c229c68f23d
```

The downloaded GitHub asset was byte-verified after publication. The app
signature is accepted by Gatekeeper, the release is notarized, and the DMG has
a valid stapled notarization ticket.

## Intentionally Unpublished

- Windows MSI and Winget, pending Windows signing and clean-machine evidence.
- Linux AppImage, deb, and rpm, pending Linux-native package verification.
- Homebrew, pending cask review and installation verification.
- VS Code Marketplace, pending publisher review and marketplace verification.
- Automatic updater manifests, pending complete cross-platform artifacts.
- PyPI package. No supported Rubric Studio Python distribution is published.

The npm package is a JavaScript validator, CLI, and release metadata companion.
It does not bundle the visual browser or desktop application.

## Runtime Boundary

The open application is local-first and does not require an AuraOne account.
Provider, model, update, documentation, and intake destinations are contacted
only when the operator explicitly invokes the corresponding action.

The browser and desktop releases do not bundle AuraOne's private font files.
The website may serve authorized premium fonts at runtime; offline and public
source builds use the declared system fallback stack.

## Verification Commands

```bash
shasum -a 256 Rubric.Studio.Open_0.2.0_aarch64.dmg
xcrun stapler validate Rubric.Studio.Open_0.2.0_aarch64.dmg
spctl --assess --type execute --verbose=2 "/Applications/Rubric Studio Open.app"
```

Passing local source tests validates the checkout. Public availability is
established separately by the immutable tag, GitHub Release asset, registry or
deployment response, checksum, and notarization evidence.

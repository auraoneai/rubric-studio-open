# Rubric Studio Open Release Readiness

Status: public-safe handoff generated from the Rubric Studio Open external readiness manifest on 2026-05-13.

This page lists the remaining account-gated, legal, security, release, registry, DNS, launch, community, and sales evidence required before the launch PRD can be marked complete. It does not contain secrets, private contacts, employee PII, signing material, or privileged legal analysis. Internal owners use the private readiness checklist and evidence templates to attach proof; public repo contributors should not commit private evidence here.

Rows can be closed only after the required evidence exists and the internal readiness verifier reports no blocker for that row.

| ID | PRD row anchor | Closure evidence required | Evidence template family |
| --- | --- | --- | --- |
| `legal-patent-grant` | Patent grant clause reviewed by counsel | Dated counsel memo, approval email export, or exception memo | `legal-security` |
| `legal-trademark` | Trademark filing for "Rubric Studio Open" and "Rubric Studio Cloud" | USPTO TEAS filing receipts or counsel docket serial numbers | `legal-security` |
| `security-pgp` | `SECURITY.md` with disclosure process and PGP key | Production security@auraone.ai PGP public key URL and fingerprint | `legal-security` |
| `security-independent-review` | Public security review by an independent contractor or audit firm | Signed contractor/audit-firm report and remediation summary | `legal-security` |
| `release-code-signing` | Code-signing certificates secured | Apple, Microsoft, and Linux GPG certificate evidence without secrets | `signing-update` |
| `release-macos-notarization` | Notarization process verified end-to-end on macOS | Signed app hash, notarization UUID, stapler validate output | `signing-update` |
| `legal-ip-assignments` | AuraOne employees who contribute have signed corporate IP assignments | Dated people/legal roster attestation | `legal-security` |
| `release-auto-update` | Auto-update mechanism. (Shared infra | DNS/TLS, signed manifest URL, app update-check output | `signing-update` |
| `launch-youtube-video` | Launch video (60–90s, hosted on YouTube + linked from GitHub README) | YouTube URL and public README commit linking it | `launch-community-sales` |
| `launch-hn` | HN Show HN post timed for Tuesday or Wednesday, 09:00 PT | HN item URL and launch timestamp | `launch-community-sales` |
| `launch-x` | X thread launched same day, 09:30 PT | Thread URL or scheduler export | `launch-community-sales` |
| `launch-linkedin` | LinkedIn post 10:00 PT | Published or scheduled LinkedIn URL | `launch-community-sales` |
| `launch-press` | Press outreach (TechCrunch, The Verge, Ars Technica | Dated sent outreach tracker | `launch-community-sales` |
| `launch-podcast` | Podcast outreach (Latent Space, The Cognitive Revolution | Dated sent podcast outreach tracker | `launch-community-sales` |
| `launch-design-partners` | Design partner list pre-briefed | NDA-free tracker with eight approved contacts and briefing dates | `launch-community-sales` |
| `launch-eight-posts` | Eight launch-day blog posts pre-scheduled | Scheduler export or eight public URLs | `launch-community-sales` |
| `launch-community-channel` | Discord / Slack community channel opened | Channel/invite URL and moderation coverage | `launch-community-sales` |
| `launch-github-discussions` | GitHub Discussions opened with seeded threads | Public discussion URLs for the five approved seed prompts | `launch-community-sales` |
| `launch-docs-subdomain` | Docs site live on a custom subdomain | DNS/TLS evidence and HTTP 200 | `registries-domains` |
| `launch-status-page` | Status page live (uptime for update server | Public status URL with live monitor checks | `registries-domains` |
| `launch-sales-briefing` | AuraOne sales team briefed on the OSS funnel | Deck, recording or notes, and attendee acknowledgement | `launch-community-sales` |
| `registry-homebrew` | **Homebrew cask:** `rubric-studio-open` | Tap URL or PR, cask audit output, signed artifact URL | `registries-domains` |
| `registry-pypi` | **PyPI package:** `rubric-studio` | PyPI project URL for 0.0.1 package | `registries-domains` |
| `registry-npm` | **npm package:** `@auraone/rubric-studio` | npm package URL for 0.0.1 package | `registries-domains` |
| `registry-vscode` | **VS Code Marketplace:** `auraone.rubric-studio` | Marketplace listing URL and publisher evidence | `registries-domains` |
| `registry-domain` | **Domain / subdomain:** `rubric-studio.auraone.ai` | DNS/TLS evidence and HTTP redirect to marketing route | `registries-domains` |
| `registry-apple-identifier` | **Apple Developer signing identifier:** `ai.auraone.rubricstudio` | Apple Developer identifier and team evidence without secrets | `registries-domains` |
| `registry-windows-identity` | **Windows app identity:** `AuraOne.RubricStudioOpen` | Partner Center or Store identity evidence | `registries-domains` |
| `registry-discord-vanity` | **Discord vanity:** confirm "rubric-studio-open" | Server/channel URL or admin availability confirmation | `registries-domains` |
| `registry-hugging-face` | **Hugging Face org:** confirm `rubric-studio-open` | Reserved Space/dataset URL or org-token confirmation | `registries-domains` |

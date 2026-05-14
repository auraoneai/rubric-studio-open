# Rubric Studio Open Release Readiness

Status: public-safe handoff generated from the Rubric Studio Open external readiness manifest on 2026-05-13.

This page lists the remaining account-gated, legal, security, release, registry, DNS, launch, community, sales, and success-metric evidence required before the launch PRD can be marked complete. It does not contain secrets, private contacts, employee PII, signing material, privileged legal analysis, private telemetry, or CRM records. Internal owners use the private readiness checklist and evidence templates to attach proof; public repo contributors should not commit private evidence here.

Rows and metrics can be closed only after the required evidence exists and the internal readiness verifier reports no blocker for that item.

## Remaining Unchecked Rows

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

## Non-Checkbox Requirements

| ID | PRD anchor | Closure evidence required | Evidence template family |
| --- | --- | --- | --- |
| `metric-github-stars` | GitHub stars | 30-day and 90-day GitHub stars export or GitHub API snapshot proving 2,000/5,000 targets | `success-metrics` |
| `metric-unique-installs` | Unique installs | Deduped anonymous install telemetry export proving 3,000/8,000 targets | `success-metrics` |
| `metric-hn-front-page` | HN front page | Launch-day HN item URL plus front-page screenshot/export with timestamp | `success-metrics` |
| `metric-named-lab-installs` | Named labs with ≥1 install | Privacy-safe opt-in telemetry or CRM export proving 25/60 named target-lab install pings | `success-metrics` |
| `metric-academic-mentions` | Academic mentions on X / blogs | Manual tracking sheet or social/listening export proving 8/25 academic mentions | `success-metrics` |
| `metric-intake-exports` | AuraOne intake exports submitted | Funnel endpoint export proving 80/400 OSS intake exports | `success-metrics` |
| `metric-sqls` | SQLs attributed to OSS | Sales CRM attribution export proving 8/35 SQL targets | `success-metrics` |
| `metric-active-design-partners` | Active design partners | PM tracker proving eight active design partners during beta and through 90 days | `success-metrics` |
| `metric-paper-mentions` | Mentions in published evaluation papers | Publication tracking sheet proving five published evaluation-paper mentions within 90 days post-GA | `success-metrics` |
| `metric-intake-conversion` | 30-day install → AuraOne intake export conversion | Funnel analytics export proving 5%+ 30-day install-to-intake conversion | `success-metrics` |
| `metric-time-to-first-score` | Time to first scored sample (median) | First-run measurement export proving 90s 30-day and 60s 90-day median targets | `success-metrics` |
| `metric-issue-response-sla` | Issue median time-to-first-response | GitHub Issues analytics export proving 24h 30-day and 12h 90-day median first-response targets | `success-metrics` |
| `phase-team-assignment` | P0-1 | Dated eng/PM/design staffing roster or owner attestation proving the core launch team was assigned | `phase-task` |
| `phase-internal-alpha-dogfood` | P1-22 | Internal alpha release artifact, dogfood participant summary, issue triage log, and release date evidence | `phase-task` |
| `phase-beta-design-partner-shipment` | P2-22 | Redacted tracker proving eight design partners were recruited and received the beta build | `phase-task` |
| `phase-beta-office-hours` | P2-23 | Office-hours schedule, redacted attendance/notes summary, and beta bug triage log | `phase-task` |
| `phase-cross-platform-clean-machine-qa` | P3-5 | Clean-machine QA logs for macOS Intel, macOS Apple Silicon, Windows 11, Ubuntu 22+, and Fedora signed installer paths | `phase-task` |
| `phase-public-launch-day` | P3-20 | Launch-day execution log tying public posts, repo release, docs/status endpoints, and support/community monitoring to the planned launch window | `phase-task` |
| `postlaunch-weekly-point-releases` | P4-1 | Release log proving weekly point releases for the first four weeks after launch | `post-launch` |
| `postlaunch-issue-triage-sla` | P4-2 | GitHub Issues analytics proving the 24h response SLA during the post-launch period | `post-launch` |
| `postlaunch-community-management` | P4-3 | Community moderation and response log for the post-launch Discord/Slack channel | `post-launch` |
| `postlaunch-cohort-interviews` | P4-4 | Redacted PM tracker proving interviews with the first 50 high-engagement installs | `post-launch` |
| `postlaunch-plugin-marketplace` | P4-5 | Implementation, docs, and release evidence for the third-party engine-library plugin marketplace | `post-launch` |
| `postlaunch-realtime-collaboration` | P4-6 | Implementation, tests, and docs for read-only initial CRDT collaboration | `post-launch` |
| `postlaunch-snap-flatpak` | P4-7 | Snapcraft and Flathub package URLs or review submissions plus install verification | `post-launch` |
| `postlaunch-microsoft-store` | P4-8 | Microsoft Store listing or submission evidence plus signed package verification | `post-launch` |
| `postlaunch-mac-app-store` | P4-9 | Mac App Store listing or submission evidence plus notarized/signed package verification | `post-launch` |
| `postlaunch-i18n` | P4-10 | Implementation, translations, locale QA, and docs for EN/ES/ZH/JA UI | `post-launch` |
| `postlaunch-advanced-calibration` | P4-11 | Implementation, tests, and docs for hierarchical IAA and latent class analysis | `post-launch` |
| `postlaunch-advanced-diff` | P4-12 | Implementation, tests, and docs for A/B testing rubric variants on the live judge fleet | `post-launch` |
| `postlaunch-roadmap-rfc` | P4-13 | Local roadmap/RFC docs, published public roadmap/RFC threads, and maintainer approval | `post-launch` |
| `postlaunch-conference-talks` | P4-14 | Submission or acceptance tracker for ICLR, NeurIPS, and ICML workshop talks | `post-launch` |
| `risk-competitor-ships-first` | R1 | Pre-announcement, launch narrative, and shipping cadence evidence proving the week-8 mindshare and engine-rich positioning mitigation executed | `risk-mitigation` |
| `risk-engine-library-quality` | R2 | Engine readiness audit, hardening evidence, version pins, and test results for all 14 engine libraries | `risk-mitigation` |
| `risk-naming-confusion` | R3 | Rename audit evidence proving Open/Cloud/Enterprise naming is consistently differentiated across product, docs, and marketing surfaces | `risk-mitigation` |
| `risk-commercial-cannibalization` | R4 | OSS/commercial boundary audit proving team-only Cloud features are absent from the OSS app and intake language is explicit | `risk-mitigation` |
| `risk-narrative-drift` | R5 | Launch/comms review proving press, README, blog, social, and founder/design-partner quotes consistently use the IDE-for-the-rubric narrative | `risk-mitigation` |
| `risk-tauri-immaturity` | R6 | Cross-platform stress-test evidence and fallback decision log covering macOS, Windows, and Linux launch builds | `risk-mitigation` |
| `risk-python-sidecar-fragility` | R7 | Sidecar lifecycle tests, health-status UI evidence, restart/backoff evidence, and bundled runtime verification | `risk-mitigation` |
| `risk-api-key-security` | R8 | Keychain-only storage evidence, documentation review, and independent security review evidence proving API keys are not leaked | `risk-mitigation` |
| `risk-telemetry-mistrust` | R9 | Telemetry default-off, event documentation, transparent log UI, and privacy review evidence | `risk-mitigation` |
| `risk-signing-av-flagging` | R10 | Code-signing, notarization, EV Windows certificate, malware-vendor submission, and user workaround documentation evidence | `risk-mitigation` |
| `risk-team-burnout` | R11 | PM/eng operating evidence for weekly 1:1s, no-weekend launch policy, buffer week, and team health follow-up | `risk-mitigation` |
| `risk-brand-policy-violation` | R12 | Automated scan, CONTRIBUTING policy, and fixture audit proving no real customer testimonials, logos, or partner data are committed | `risk-mitigation` |
| `risk-license-contamination` | R13 | License-scanning CI, code-review checklist, and full dependency audit evidence proving no GPL contamination | `risk-mitigation` |
| `risk-dco-confusion` | R14 | DCO workflow and CONTRIBUTING evidence documenting signed-off-by contribution flow | `risk-mitigation` |
| `risk-hn-launch-flop` | R15 | HN launch text, pinned demo video, comment-coverage plan, and wave-2 social post evidence | `risk-mitigation` |
| `risk-funnel-underperforms` | R16 | P4 funnel review evidence covering intake export conversion, Cloud onboarding follow-up, and weekly adjustment plan | `risk-mitigation` |

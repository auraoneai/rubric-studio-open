# FAQ

## Is Rubric Studio Open a hosted product?

No. It is local-first desktop software with a browser editor and CLI companion. It stores projects as folders on disk.

## Is it free?

Yes. Rubric Studio Open is MIT-licensed. Cloud, Enterprise, and managed Rubric Programs are separate commercial offerings.

## Does it send my rubric to AuraOne?

No. The app sends nothing by default. AuraOne intake export requires an explicit preview and confirmation.

## Where are API keys stored?

Provider keys are stored in the operating system keychain: macOS Keychain Services, Windows Credential Manager, or Linux Secret Service with a documented fallback.

## Does telemetry run by default?

No. Telemetry preview and crash reporting are off by default. This build has no
telemetry uploader. The privacy settings page shows local `local_preview` and
`would_send` event JSON; neither status means uploaded.

## Can I use it without network access?

Yes. No-network mode supports authoring, validation, mock-judge scoring, diffs,
and local exports. Provider scoring, update checks, crash upload, and intake
upload are disabled. Telemetry remains a local-only preview because this build
has no telemetry uploader.

## Which frameworks can I export to?

Planned P0/P1 adapters include rubric-spec, judge-card, eval-run-manifest, lm-eval-harness, Inspect, OpenAI Evals, Promptfoo, Hugging Face Hub metadata, Surge SOW, Scale task spec, and AuraOne intake.

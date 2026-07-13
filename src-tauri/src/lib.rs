use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod project;

const KEYCHAIN_SERVICE: &str = "rubric-studio-open";
const PROVIDER_KEY_SCOPE: &str = "byo-api-keys";
const INTAKE_INSTALL_SIGNING_KEY_SCOPE: &str = "intake-install-signing-key";
const INTAKE_INSTALL_SIGNING_KEY_IDENTIFIER: &str = "ed25519-install-keypair-v1";

pub use project::{
    create_rubric_project_from_template, open_rubric_project_folder, save_rubric_project_folder,
    OpenedRubricProject, ProjectOpenFailure, RubricProjectFile, SavedRubricProject,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CriterionInput {
    pub id: String,
    pub label: String,
    pub description: String,
    pub weight: f64,
    pub positive_examples: Vec<String>,
    pub negative_examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SampleInput {
    pub id: String,
    pub prompt: String,
    pub response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ValidationIssue {
    pub criterion_id: Option<String>,
    pub field: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScoreOutput {
    pub criterion_id: String,
    pub sample_id: String,
    pub verdict: String,
    pub score: f64,
    pub confidence: f64,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiffOutput {
    pub criterion_id: String,
    pub severity: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeychainKey {
    pub service: String,
    pub scope: String,
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeychainReceipt {
    pub service: String,
    pub scope: String,
    pub identifier_hash: String,
    pub backend: String,
    pub native_bridge_required: bool,
    pub stores_user_content: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeychainStatus {
    pub service: String,
    pub backend: String,
    pub allowed_scopes: Vec<String>,
    pub stores_user_content: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeychainFailure {
    pub field: String,
    pub message: String,
    pub secret_redacted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SidecarKind {
    IaaKit,
    JudgeBench,
    ContaminationAudit,
    PromptRubricDrift,
    EvalAdapter,
    DatasheetCi,
    Evalkit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SidecarRequest {
    pub kind: SidecarKind,
    pub input_json: String,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SidecarInvocation {
    pub executable: String,
    pub args: Vec<String>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    pub sends_api_keys: bool,
    pub network_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SidecarFailure {
    pub kind: SidecarKind,
    pub message: String,
    pub child_crash_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReliabilityStatus {
    pub crash: CrashReporterStatus,
    pub updater: UpdaterStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrashReporterStatus {
    pub enabled: bool,
    pub provider: String,
    pub project: String,
    pub default_off: bool,
    pub scrub_paths: bool,
    pub scrub_hostnames: bool,
    pub scrub_api_keys: bool,
    pub sends_user_authored_content: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdaterStatus {
    pub active: bool,
    pub channel: String,
    pub endpoints: Vec<String>,
    pub pubkey: String,
    pub signature_required: bool,
    pub kill_switch_supported: bool,
}

pub fn validate_project(criteria: Vec<CriterionInput>) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut ids = std::collections::HashSet::new();

    for criterion in criteria {
        if !ids.insert(criterion.id.clone()) {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "id".into(),
                severity: "error".into(),
                message: "Criterion id must be unique.".into(),
            });
        }
        if criterion.label.trim().is_empty() {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "label".into(),
                severity: "error".into(),
                message: "Label is required.".into(),
            });
        }
        if criterion.description.trim().is_empty() {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "description".into(),
                severity: "error".into(),
                message: "Description is required.".into(),
            });
        }
        if !(0.0..=1.0).contains(&criterion.weight) {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "weight".into(),
                severity: "error".into(),
                message: "Weight must be between 0 and 1.".into(),
            });
        }
        if criterion.positive_examples.len() < 2 {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "positiveExamples".into(),
                severity: "suggestion".into(),
                message: "Add at least two positive examples.".into(),
            });
        }
        if criterion.negative_examples.len() < 2 {
            issues.push(ValidationIssue {
                criterion_id: Some(criterion.id.clone()),
                field: "negativeExamples".into(),
                severity: "suggestion".into(),
                message: "Add at least two negative examples.".into(),
            });
        }
    }

    issues
}

pub fn mock_score(
    criteria: Vec<CriterionInput>,
    sample: SampleInput,
    judge_id: String,
) -> Vec<ScoreOutput> {
    criteria
        .into_iter()
        .map(|criterion| {
            let hash = stable_hash(&format!(
                "{}:{}:{}:{}",
                criterion.id, sample.id, judge_id, sample.response
            ));
            let mut score = 0.45 + ((hash % 41) as f64 / 100.0);
            let response = sample.response.to_lowercase();
            for example in &criterion.positive_examples {
                if shared_token(&response, example) {
                    score += 0.12;
                }
            }
            for example in &criterion.negative_examples {
                if shared_token(&response, example) {
                    score -= 0.14;
                }
            }
            score = score.clamp(0.0, 1.0);
            let verdict = if score >= 0.67 {
                "pass"
            } else if score >= 0.4 {
                "partial"
            } else {
                "fail"
            };
            ScoreOutput {
                criterion_id: criterion.id.clone(),
                sample_id: sample.id.clone(),
                verdict: verdict.into(),
                score: round2(score),
                confidence: round2(0.61 + ((hash % 32) as f64 / 100.0)),
                reasoning: format!(
                    "Local mock judge marked '{}' as {} using deterministic content-hash scoring.",
                    criterion.label,
                    verdict.to_uppercase()
                ),
            }
        })
        .collect()
}

pub fn semantic_diff(
    current: Vec<CriterionInput>,
    baseline: Vec<CriterionInput>,
) -> Vec<DiffOutput> {
    let baseline_by_id: std::collections::HashMap<String, CriterionInput> = baseline
        .into_iter()
        .map(|criterion| (criterion.id.clone(), criterion))
        .collect();

    current
        .into_iter()
        .map(|criterion| match baseline_by_id.get(&criterion.id) {
            None => DiffOutput {
                criterion_id: criterion.id,
                severity: "breaking".into(),
                summary: "New criterion added; downstream score contracts may change.".into(),
            },
            Some(previous) if (previous.weight - criterion.weight).abs() > 0.05 => DiffOutput {
                criterion_id: criterion.id,
                severity: "substantive".into(),
                summary: "Criterion weight changed enough to affect aggregate scores.".into(),
            },
            Some(previous) if previous.description != criterion.description => DiffOutput {
                criterion_id: criterion.id,
                severity: "substantive".into(),
                summary: "Criterion description changed; review semantic intent before merge."
                    .into(),
            },
            Some(_) => DiffOutput {
                criterion_id: criterion.id,
                severity: "cosmetic".into(),
                summary: "No rubric-spec semantic change detected.".into(),
            },
        })
        .collect()
}

pub fn keychain_status() -> KeychainStatus {
    KeychainStatus {
        service: KEYCHAIN_SERVICE.into(),
        backend: keychain_backend_label().into(),
        allowed_scopes: vec![
            PROVIDER_KEY_SCOPE.into(),
            INTAKE_INSTALL_SIGNING_KEY_SCOPE.into(),
        ],
        stores_user_content: false,
    }
}

pub fn prepare_keychain_set(
    key: KeychainKey,
    secret: String,
) -> Result<KeychainReceipt, KeychainFailure> {
    validate_keychain_key(&key)?;
    if secret.trim().len() < 8 {
        return Err(KeychainFailure {
            field: "secret".into(),
            message: "Keychain secret must be at least eight characters.".into(),
            secret_redacted: true,
        });
    }

    Ok(KeychainReceipt {
        service: key.service,
        scope: key.scope,
        identifier_hash: sha256_hex(&key.identifier)[0..16].into(),
        backend: keychain_backend_label().into(),
        native_bridge_required: true,
        stores_user_content: false,
    })
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub fn store_keychain_secret(
    key: KeychainKey,
    secret: String,
) -> Result<KeychainReceipt, KeychainFailure> {
    let receipt = prepare_keychain_set(key.clone(), secret.clone())?;
    let entry = keyring::Entry::new_with_target(&key.scope, &key.service, &key.identifier)
        .map_err(|error| KeychainFailure {
            field: "backend".into(),
            message: format!("OS keychain entry could not be opened: {error}"),
            secret_redacted: true,
        })?;
    entry
        .set_password(&secret)
        .map_err(|error| KeychainFailure {
            field: "backend".into(),
            message: format!("OS keychain write failed: {error}"),
            secret_redacted: true,
        })?;
    Ok(receipt)
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub fn read_keychain_secret(key: KeychainKey) -> Result<Option<String>, KeychainFailure> {
    validate_keychain_key(&key)?;
    let entry = keyring::Entry::new_with_target(&key.scope, &key.service, &key.identifier)
        .map_err(|error| KeychainFailure {
            field: "backend".into(),
            message: format!("OS keychain entry could not be opened: {error}"),
            secret_redacted: true,
        })?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(KeychainFailure {
            field: "backend".into(),
            message: format!("OS keychain read failed: {error}"),
            secret_redacted: true,
        }),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn store_keychain_secret(
    key: KeychainKey,
    secret: String,
) -> Result<KeychainReceipt, KeychainFailure> {
    prepare_keychain_set(key, secret)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn read_keychain_secret(key: KeychainKey) -> Result<Option<String>, KeychainFailure> {
    validate_keychain_key(&key)?;
    Ok(None)
}

pub fn prepare_sidecar_invocation(
    request: SidecarRequest,
) -> Result<SidecarInvocation, SidecarFailure> {
    if request.input_json.len() > 4 * 1024 * 1024 {
        return Err(sidecar_failure(
            request.kind,
            "sidecar input exceeds the 4 MB local IPC limit",
        ));
    }
    if serde_json::from_str::<serde_json::Value>(&request.input_json).is_err() {
        return Err(sidecar_failure(
            request.kind,
            "sidecar input must be valid JSON",
        ));
    }
    let timeout_ms = request.timeout_ms.clamp(1_000, 120_000);
    let max_output_bytes = request.max_output_bytes.clamp(1_024, 8 * 1024 * 1024);
    let (executable, command) = match request.kind {
        SidecarKind::IaaKit => ("python3", "iaa-kit"),
        SidecarKind::JudgeBench => ("python3", "judge-bench"),
        SidecarKind::ContaminationAudit => ("python3", "contamination-audit"),
        SidecarKind::PromptRubricDrift => ("python3", "prompt-rubric-drift"),
        SidecarKind::EvalAdapter => ("python3", "eval-adapter"),
        SidecarKind::DatasheetCi => ("node", "datasheet-ci"),
        SidecarKind::Evalkit => ("python3", "auraone-evalkit"),
    };

    Ok(SidecarInvocation {
        executable: executable.into(),
        args: vec!["-m".into(), command.into(), "--json-stdin".into()],
        timeout_ms,
        max_output_bytes,
        sends_api_keys: false,
        network_allowed: false,
    })
}

pub fn reliability_status(crash_enabled: bool, update_channel: String) -> ReliabilityStatus {
    let channel = match update_channel.as_str() {
        "stable" | "beta" => update_channel,
        _ => "stable".into(),
    };

    ReliabilityStatus {
        crash: CrashReporterStatus {
            enabled: crash_enabled,
            provider: "sentry".into(),
            project: "rubric-studio-open".into(),
            default_off: true,
            scrub_paths: true,
            scrub_hostnames: true,
            scrub_api_keys: true,
            sends_user_authored_content: false,
        },
        updater: UpdaterStatus {
            active: true,
            channel,
            endpoints: vec![
                "https://updates.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}".into(),
                "https://updates2.auraone.ai/rubric-studio-open/{{target}}/{{arch}}/{{current_version}}".into(),
            ],
            pubkey: "DAKD/Nqj4KoXZpXv9li/zVQv+2LhThXE5J9tx0Wl1B8=".into(),
            signature_required: true,
            kill_switch_supported: true,
        },
    }
}

pub fn git_status_summary(branch: &str, changed_files: usize) -> String {
    format!("{branch}: {changed_files} changed files, local-only")
}

fn sidecar_failure(kind: SidecarKind, message: &str) -> SidecarFailure {
    SidecarFailure {
        kind,
        message: message.into(),
        child_crash_safe: true,
    }
}

fn validate_keychain_key(key: &KeychainKey) -> Result<(), KeychainFailure> {
    for (field, value) in [
        ("service", &key.service),
        ("scope", &key.scope),
        ("identifier", &key.identifier),
    ] {
        let mut characters = value.chars();
        let starts_with_alphanumeric = characters
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric());
        if !starts_with_alphanumeric
            || !characters
                .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
        {
            return Err(KeychainFailure {
                field: field.into(),
                message: format!("{field} contains unsupported characters"),
                secret_redacted: true,
            });
        }
    }
    if key.service != KEYCHAIN_SERVICE {
        return Err(KeychainFailure {
            field: "service".into(),
            message: "Keychain service must be rubric-studio-open.".into(),
            secret_redacted: true,
        });
    }
    match key.scope.as_str() {
        PROVIDER_KEY_SCOPE => {}
        INTAKE_INSTALL_SIGNING_KEY_SCOPE
            if key.identifier == INTAKE_INSTALL_SIGNING_KEY_IDENTIFIER => {}
        INTAKE_INSTALL_SIGNING_KEY_SCOPE => {
            return Err(KeychainFailure {
                field: "identifier".into(),
                message:
                    "Intake install signing keys must use the shared Ed25519 install identity."
                        .into(),
                secret_redacted: true,
            });
        }
        _ => {
            return Err(KeychainFailure {
                field: "scope".into(),
                message: "Rubric Studio Open only stores BYO provider keys and its intake install signing identity in the OS keychain.".into(),
                secret_redacted: true,
            });
        }
    }
    Ok(())
}

fn keychain_backend_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos-keychain-services"
    } else if cfg!(target_os = "windows") {
        "windows-credential-manager"
    } else if cfg!(target_os = "linux") {
        "linux-secret-service"
    } else {
        "platform-keychain"
    }
}

fn shared_token(haystack: &str, example: &str) -> bool {
    example
        .to_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| token.len() > 4)
        .any(|token| haystack.contains(token))
}

fn stable_hash(value: &str) -> u64 {
    let digest = Sha256::digest(value.as_bytes());
    u64::from_be_bytes(
        digest[0..8]
            .try_into()
            .expect("sha256 prefix has eight bytes"),
    )
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn criterion(id: &str) -> CriterionInput {
        CriterionInput {
            id: id.into(),
            label: "Specific answer".into(),
            description: "The answer provides observable, specific guidance.".into(),
            weight: 0.5,
            positive_examples: vec!["specific guidance".into(), "clear checklist".into()],
            negative_examples: vec!["generic encouragement".into(), "missing details".into()],
        }
    }

    #[test]
    fn validates_criterion_shape() {
        let mut item = criterion("specificity");
        item.weight = 1.4;
        item.negative_examples = vec![];

        let issues = validate_project(vec![item]);

        assert!(issues.iter().any(|issue| issue.field == "weight"));
        assert!(issues.iter().any(|issue| issue.field == "negativeExamples"));
    }

    #[test]
    fn mock_score_is_deterministic() {
        let sample = SampleInput {
            id: "s1".into(),
            prompt: "Improve this rubric".into(),
            response: "Use a specific checklist with clear details.".into(),
        };
        let first = mock_score(
            vec![criterion("specificity")],
            sample.clone(),
            "local-mock".into(),
        );
        let second = mock_score(vec![criterion("specificity")], sample, "local-mock".into());

        assert_eq!(first, second);
        assert_eq!(first.len(), 1);
    }

    #[test]
    fn semantic_diff_labels_weight_changes() {
        let mut current = criterion("specificity");
        current.weight = 0.8;

        let diff = semantic_diff(vec![current], vec![criterion("specificity")]);

        assert_eq!(diff[0].severity, "substantive");
    }

    #[test]
    fn keychain_bridge_accepts_provider_keys_and_redacts_secret() {
        let receipt = prepare_keychain_set(
            KeychainKey {
                service: KEYCHAIN_SERVICE.into(),
                scope: PROVIDER_KEY_SCOPE.into(),
                identifier: "openai-gpt-5-mini".into(),
            },
            "sk-test-value".into(),
        )
        .unwrap();

        assert_eq!(receipt.service, KEYCHAIN_SERVICE);
        assert_eq!(receipt.scope, PROVIDER_KEY_SCOPE);
        assert_eq!(receipt.identifier_hash.len(), 16);
        assert!(receipt.native_bridge_required);
        assert!(!receipt.stores_user_content);
        assert!(!format!("{receipt:?}").contains("sk-test-value"));
    }

    #[test]
    fn keychain_bridge_accepts_shared_intake_install_signing_identity() {
        let status = keychain_status();
        assert_eq!(
            status.allowed_scopes,
            vec![
                PROVIDER_KEY_SCOPE.to_string(),
                INTAKE_INSTALL_SIGNING_KEY_SCOPE.to_string(),
            ]
        );

        let receipt = prepare_keychain_set(
            KeychainKey {
                service: KEYCHAIN_SERVICE.into(),
                scope: INTAKE_INSTALL_SIGNING_KEY_SCOPE.into(),
                identifier: INTAKE_INSTALL_SIGNING_KEY_IDENTIFIER.into(),
            },
            "{\"algorithm\":\"Ed25519\",\"private_key\":\"secret\",\"public_key\":\"pub\"}".into(),
        )
        .unwrap();

        assert_eq!(receipt.service, KEYCHAIN_SERVICE);
        assert_eq!(receipt.scope, INTAKE_INSTALL_SIGNING_KEY_SCOPE);
        assert_eq!(receipt.identifier_hash.len(), 16);
        assert!(!receipt.stores_user_content);
    }

    #[test]
    fn keychain_bridge_rejects_user_content_scope() {
        let error = prepare_keychain_set(
            KeychainKey {
                service: KEYCHAIN_SERVICE.into(),
                scope: "project-content".into(),
                identifier: "rubric-body".into(),
            },
            "user-authored rubric text".into(),
        )
        .unwrap_err();

        assert_eq!(error.field, "scope");
        assert!(error.secret_redacted);
    }

    #[test]
    fn keychain_bridge_rejects_invalid_service_and_identifiers() {
        let invalid_keys = [
            (
                KeychainKey {
                    service: "another-app".into(),
                    scope: PROVIDER_KEY_SCOPE.into(),
                    identifier: "openai-gpt-5-mini".into(),
                },
                "service",
            ),
            (
                KeychainKey {
                    service: KEYCHAIN_SERVICE.into(),
                    scope: PROVIDER_KEY_SCOPE.into(),
                    identifier: "openai/key".into(),
                },
                "identifier",
            ),
            (
                KeychainKey {
                    service: KEYCHAIN_SERVICE.into(),
                    scope: PROVIDER_KEY_SCOPE.into(),
                    identifier: "-openai-key".into(),
                },
                "identifier",
            ),
            (
                KeychainKey {
                    service: KEYCHAIN_SERVICE.into(),
                    scope: INTAKE_INSTALL_SIGNING_KEY_SCOPE.into(),
                    identifier: "another-install-key".into(),
                },
                "identifier",
            ),
        ];

        for (key, expected_field) in invalid_keys {
            let error = prepare_keychain_set(key, "secret-value".into()).unwrap_err();
            assert_eq!(error.field, expected_field);
            assert!(error.secret_redacted);
        }
    }

    #[test]
    fn sidecar_invocation_is_sandboxed_and_keyless() {
        let invocation = prepare_sidecar_invocation(SidecarRequest {
            kind: SidecarKind::IaaKit,
            input_json: "{\"pairs\":[]}".into(),
            timeout_ms: 999_999,
            max_output_bytes: 999_999_999,
        })
        .unwrap();

        assert_eq!(invocation.timeout_ms, 120_000);
        assert_eq!(invocation.max_output_bytes, 8 * 1024 * 1024);
        assert!(!invocation.sends_api_keys);
        assert!(!invocation.network_allowed);
    }

    #[test]
    fn sidecar_rejects_invalid_json_without_crashing_app() {
        let error = prepare_sidecar_invocation(SidecarRequest {
            kind: SidecarKind::EvalAdapter,
            input_json: "not-json".into(),
            timeout_ms: 1_000,
            max_output_bytes: 1_024,
        })
        .unwrap_err();

        assert!(error.child_crash_safe);
        assert!(error.message.contains("valid JSON"));
    }

    #[test]
    fn reliability_status_uses_platform_update_and_crash_contracts() {
        let status = reliability_status(false, "beta".into());

        assert!(!status.crash.enabled);
        assert!(status.crash.default_off);
        assert!(status.crash.scrub_api_keys);
        assert!(!status.crash.sends_user_authored_content);
        assert!(status.updater.active);
        assert_eq!(status.updater.channel, "beta");
        assert!(status.updater.signature_required);
        assert!(status.updater.kill_switch_supported);
        assert!(status.updater.endpoints[0].starts_with("https://updates.auraone.ai/"));
        assert_eq!(
            status.updater.pubkey,
            "DAKD/Nqj4KoXZpXv9li/zVQv+2LhThXE5J9tx0Wl1B8="
        );
    }

    #[test]
    fn opens_rubric_project_folder_from_manifest() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_path = manifest_dir
            .parent()
            .unwrap()
            .join("examples/helpful-response-evaluation");

        let opened = open_rubric_project_folder(project_path).unwrap();

        assert_eq!(opened.project.id, "helpful-response-evaluation");
        assert_eq!(opened.project.criteria.len(), 4);
        assert!(opened
            .project
            .themes
            .iter()
            .any(|theme| theme.id == "safety"));
        assert!(opened
            .project
            .samples
            .iter()
            .any(|sample| sample.id == "sample-001"));
        assert!(opened
            .project
            .judges
            .iter()
            .any(|judge| judge.id == "local-mock"));
        assert!(!opened.project.judges[0].key_configured);
    }

    #[test]
    fn creates_rubric_project_from_template_folder() {
        let parent = std::env::temp_dir().join(format!(
            "rubric-studio-open-template-test-{}-{}",
            std::process::id(),
            stable_hash("template")
        ));
        std::fs::create_dir_all(&parent).unwrap();

        let opened =
            create_rubric_project_from_template(parent.clone(), "Demo Template Rubric".into())
                .unwrap();

        assert_eq!(opened.project.id, "demo-template-rubric");
        assert_eq!(opened.project.criteria.len(), 4);
        assert!(PathBuf::from(&opened.path).join("rubric.toml").exists());
        assert!(PathBuf::from(&opened.path)
            .join("criteria/safety/safe-refusal.toml")
            .exists());
        assert!(opened
            .project
            .samples
            .iter()
            .any(|sample| sample.id == "sample-003"));

        std::fs::remove_dir_all(parent).unwrap();
    }
}

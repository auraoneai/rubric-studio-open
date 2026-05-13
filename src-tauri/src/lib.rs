use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IntakeManifest {
    pub packet_version: String,
    pub product: String,
    pub content_hash: String,
    pub sends_api_keys: bool,
    pub explicit_user_action_required: bool,
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

pub fn mock_score(criteria: Vec<CriterionInput>, sample: SampleInput, judge_id: String) -> Vec<ScoreOutput> {
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

pub fn semantic_diff(current: Vec<CriterionInput>, baseline: Vec<CriterionInput>) -> Vec<DiffOutput> {
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
                summary: "Criterion description changed; review semantic intent before merge.".into(),
            },
            Some(_) => DiffOutput {
                criterion_id: criterion.id,
                severity: "cosmetic".into(),
                summary: "No rubric-spec semantic change detected.".into(),
            },
        })
        .collect()
}

pub fn build_intake_manifest(project_id: String, payload_json: String) -> IntakeManifest {
    IntakeManifest {
        packet_version: "auraonepkg.v1".into(),
        product: format!("rubric-studio-open/{project_id}"),
        content_hash: sha256_hex(&payload_json),
        sends_api_keys: false,
        explicit_user_action_required: true,
    }
}

pub fn prepare_sidecar_invocation(request: SidecarRequest) -> Result<SidecarInvocation, SidecarFailure> {
    if request.input_json.len() > 4 * 1024 * 1024 {
        return Err(sidecar_failure(
            request.kind,
            "sidecar input exceeds the 4 MB local IPC limit",
        ));
    }
    if serde_json::from_str::<serde_json::Value>(&request.input_json).is_err() {
        return Err(sidecar_failure(request.kind, "sidecar input must be valid JSON"));
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

fn shared_token(haystack: &str, example: &str) -> bool {
    example
        .to_lowercase()
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| token.len() > 4)
        .any(|token| haystack.contains(token))
}

fn stable_hash(value: &str) -> u64 {
    let digest = Sha256::digest(value.as_bytes());
    u64::from_be_bytes(digest[0..8].try_into().expect("sha256 prefix has eight bytes"))
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
        let first = mock_score(vec![criterion("specificity")], sample.clone(), "local-mock".into());
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
    fn intake_manifest_never_contains_keys() {
        let manifest = build_intake_manifest("demo".into(), "{\"rubric\":true}".into());

        assert!(!manifest.sends_api_keys);
        assert!(manifest.explicit_user_action_required);
        assert_eq!(manifest.content_hash.len(), 64);
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
}

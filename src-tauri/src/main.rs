#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn validate_project(
    criteria: Vec<rubric_studio_open_core::CriterionInput>,
) -> Vec<rubric_studio_open_core::ValidationIssue> {
    rubric_studio_open_core::validate_project(criteria)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn mock_score(
    criteria: Vec<rubric_studio_open_core::CriterionInput>,
    sample: rubric_studio_open_core::SampleInput,
    judge_id: String,
) -> Vec<rubric_studio_open_core::ScoreOutput> {
    rubric_studio_open_core::mock_score(criteria, sample, judge_id)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn semantic_diff(
    current: Vec<rubric_studio_open_core::CriterionInput>,
    baseline: Vec<rubric_studio_open_core::CriterionInput>,
) -> Vec<rubric_studio_open_core::DiffOutput> {
    rubric_studio_open_core::semantic_diff(current, baseline)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn build_intake_manifest(
    project_id: String,
    payload_json: String,
) -> rubric_studio_open_core::IntakeManifest {
    rubric_studio_open_core::build_intake_manifest(project_id, payload_json)
}

#[cfg(feature = "tauri-runtime")]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            validate_project,
            mock_score,
            semantic_diff,
            build_intake_manifest
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rubric Studio Open");
}

#[cfg(not(feature = "tauri-runtime"))]
fn main() {
    println!(
        "{}",
        rubric_studio_open_core::git_status_summary("main", 0)
    );
}

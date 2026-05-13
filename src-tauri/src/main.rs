mod deep_link;

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
#[tauri::command]
fn platform_keychain_status() -> rubric_studio_open_core::KeychainStatus {
    rubric_studio_open_core::keychain_status()
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn platform_keychain_set(
    key: rubric_studio_open_core::KeychainKey,
    value: String,
    secret: bool,
) -> Result<rubric_studio_open_core::KeychainReceipt, rubric_studio_open_core::KeychainFailure> {
    if !secret {
        return Err(rubric_studio_open_core::KeychainFailure {
            field: "secret".into(),
            message: "Keychain writes must be marked as secret IPC payloads.".into(),
            secret_redacted: true,
        });
    }
    rubric_studio_open_core::store_keychain_secret(key, value)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn prepare_sidecar_invocation(
    request: rubric_studio_open_core::SidecarRequest,
) -> Result<rubric_studio_open_core::SidecarInvocation, rubric_studio_open_core::SidecarFailure> {
    rubric_studio_open_core::prepare_sidecar_invocation(request)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn platform_reliability_status(
    crash_enabled: bool,
    update_channel: String,
) -> rubric_studio_open_core::ReliabilityStatus {
    rubric_studio_open_core::reliability_status(crash_enabled, update_channel)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
fn open_rubric_project_folder(
    path: std::path::PathBuf,
) -> Result<rubric_studio_open_core::OpenedRubricProject, rubric_studio_open_core::ProjectOpenFailure>
{
    rubric_studio_open_core::open_rubric_project_folder(path)
}

#[cfg(feature = "tauri-runtime")]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            deep_link::register(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            validate_project,
            mock_score,
            semantic_diff,
            build_intake_manifest,
            platform_keychain_status,
            platform_keychain_set,
            prepare_sidecar_invocation,
            platform_reliability_status,
            open_rubric_project_folder
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rubric Studio Open");
}

#[cfg(not(feature = "tauri-runtime"))]
fn main() {
    println!("{}", rubric_studio_open_core::git_status_summary("main", 0));
}

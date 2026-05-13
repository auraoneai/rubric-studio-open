#[cfg(feature = "tauri-runtime")]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            rubric_studio_open_core::validate_project,
            rubric_studio_open_core::mock_score,
            rubric_studio_open_core::semantic_diff,
            rubric_studio_open_core::build_intake_manifest
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

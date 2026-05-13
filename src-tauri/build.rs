fn main() {
    if std::env::var_os("CARGO_FEATURE_TAURI_RUNTIME").is_some() {
        tauri_build::build();
    }
}

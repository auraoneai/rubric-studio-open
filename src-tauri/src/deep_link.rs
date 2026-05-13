use std::collections::BTreeMap;

use serde::Serialize;
use url::Url;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkPayload {
    pub flagship: String,
    pub action: String,
    pub params: BTreeMap<String, String>,
    pub install_url: Option<String>,
}

#[cfg(feature = "tauri-runtime")]
pub fn register(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Emitter;
    use tauri_plugin_deep_link::DeepLinkExt;

    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(payload) = parse_auraone_url(&url) {
                let _ = handle.emit("auraone://deep-link", payload);
            }
        }
    });
    Ok(())
}

pub fn parse_auraone_url(url: &Url) -> Option<DeepLinkPayload> {
    if url.scheme() != "auraone" {
        return None;
    }

    let flagship = url.host_str()?.to_string();
    let action = url.path().trim_start_matches('/').to_string();
    let params = url
        .query_pairs()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    let install_url = if is_registered_flagship(&flagship) {
        None
    } else {
        Some(format!("https://auraone.ai/open/{flagship}"))
    };

    Some(DeepLinkPayload {
        flagship,
        action,
        params,
        install_url,
    })
}

fn is_registered_flagship(flagship: &str) -> bool {
    matches!(
        flagship,
        "rubric-studio"
            | "rubric-studio-open"
            | "robotics-studio"
            | "robotics-studio-open"
            | "agent-studio"
            | "agent-studio-open"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rubric_open_project_deep_link() {
        let url = Url::parse("auraone://rubric-studio-open/open-project?path=/tmp/rubric").unwrap();
        let payload = parse_auraone_url(&url).unwrap();

        assert_eq!(payload.flagship, "rubric-studio-open");
        assert_eq!(payload.action, "open-project");
        assert_eq!(payload.params["path"], "/tmp/rubric");
        assert_eq!(payload.install_url, None);
    }

    #[test]
    fn routes_unknown_flagship_to_install_page() {
        let url = Url::parse("auraone://future-studio/open").unwrap();
        let payload = parse_auraone_url(&url).unwrap();

        assert_eq!(
            payload.install_url,
            Some("https://auraone.ai/open/future-studio".to_string()),
        );
    }

    #[test]
    fn rejects_non_auraone_scheme() {
        let url = Url::parse("https://auraone.ai/open/rubric-studio-open").unwrap();
        assert_eq!(parse_auraone_url(&url), None);
    }
}

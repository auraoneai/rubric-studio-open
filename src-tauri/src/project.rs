use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRubricProject {
    pub project: RubricProjectFile,
    pub path: String,
    pub opened_at: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricProjectFile {
    pub id: String,
    pub name: String,
    pub version: String,
    pub branch: String,
    pub themes: Vec<ThemeFile>,
    pub criteria: Vec<CriterionFile>,
    pub samples: Vec<SampleFile>,
    pub judges: Vec<JudgeFile>,
    pub comments_visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeFile {
    pub id: String,
    pub label: String,
    pub description: String,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CriterionFile {
    pub id: String,
    pub label: String,
    pub theme_id: String,
    pub description: String,
    pub weight: f64,
    pub scale: String,
    pub positive_examples: Vec<String>,
    pub negative_examples: Vec<String>,
    pub anti_patterns: Vec<String>,
    pub boundaries: String,
    pub edge_cases: Vec<String>,
    pub evidence_requirement: String,
    pub tags: Vec<String>,
    pub references: Vec<String>,
    pub sibling_links: Vec<String>,
    pub status: String,
    pub comments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SampleFile {
    pub id: String,
    pub prompt: String,
    pub response: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub gold_scores: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JudgeFile {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub enabled: bool,
    pub key_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectOpenFailure {
    pub field: String,
    pub message: String,
}

pub fn open_rubric_project_folder(
    path: PathBuf,
) -> Result<OpenedRubricProject, ProjectOpenFailure> {
    let project_root = path.canonicalize().map_err(|error| {
        project_open_failure("path", format!("Project path is not readable: {error}"))
    })?;
    if !project_root.is_dir() {
        return Err(project_open_failure(
            "path",
            "Project path must be a folder.",
        ));
    }

    let manifest_path = project_root.join("rubric.toml");
    let manifest_source = std::fs::read_to_string(&manifest_path).map_err(|error| {
        project_open_failure(
            "rubric.toml",
            format!("rubric.toml could not be read: {error}"),
        )
    })?;
    let manifest = manifest_source.parse::<toml::Value>().map_err(|error| {
        project_open_failure(
            "rubric.toml",
            format!("rubric.toml is invalid TOML: {error}"),
        )
    })?;
    let paths = manifest.get("paths");

    let project = RubricProjectFile {
        id: manifest
            .get("project")
            .and_then(|project| project.get("id"))
            .and_then(toml::Value::as_str)
            .unwrap_or_else(|| slug_manifest_name(&manifest))
            .into(),
        name: manifest
            .get("name")
            .and_then(toml::Value::as_str)
            .unwrap_or("Untitled Rubric")
            .into(),
        version: manifest
            .get("version")
            .and_then(toml::Value::as_str)
            .unwrap_or("0.1.0")
            .into(),
        branch: "main".into(),
        themes: read_themes(&project_root, paths)?,
        criteria: read_criteria(&project_root, paths)?,
        samples: read_samples(&project_root, paths)?,
        judges: read_judges(&project_root, paths)?,
        comments_visible: true,
    };

    if project.criteria.is_empty() {
        return Err(project_open_failure(
            "criteria",
            "Rubric project must include at least one criteria/*.toml file.",
        ));
    }

    Ok(OpenedRubricProject {
        project,
        path: project_root.to_string_lossy().into_owned(),
        opened_at: current_unix_timestamp_string(),
        source: "desktop-folder".into(),
    })
}

fn read_themes(
    root: &Path,
    paths: Option<&toml::Value>,
) -> Result<Vec<ThemeFile>, ProjectOpenFailure> {
    let themes_root = root.join(path_from_manifest(paths, "themes", "themes"));
    let mut themes = Vec::new();
    for file in sorted_files(&themes_root, "md")? {
        let source = std::fs::read_to_string(&file).map_err(|error| {
            project_open_failure("themes", format!("Theme file could not be read: {error}"))
        })?;
        let id = file_stem(&file);
        let mut lines = source.lines();
        let label = lines
            .find_map(|line| line.strip_prefix("# ").map(str::trim))
            .filter(|line| !line.is_empty())
            .unwrap_or(&id)
            .to_string();
        let description = source
            .lines()
            .filter(|line| !line.starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        themes.push(ThemeFile {
            id,
            label,
            description,
            collapsed: false,
        });
    }
    Ok(themes)
}

fn read_criteria(
    root: &Path,
    paths: Option<&toml::Value>,
) -> Result<Vec<CriterionFile>, ProjectOpenFailure> {
    let criteria_root = root.join(path_from_manifest(paths, "criteria", "criteria"));
    let mut criteria = Vec::new();
    for file in sorted_files(&criteria_root, "toml")? {
        let source = std::fs::read_to_string(&file).map_err(|error| {
            project_open_failure(
                "criteria",
                format!("Criterion file could not be read: {error}"),
            )
        })?;
        let value = source.parse::<toml::Value>().map_err(|error| {
            project_open_failure(
                "criteria",
                format!("Criterion file is invalid TOML: {error}"),
            )
        })?;
        criteria.push(CriterionFile {
            id: required_string(&value, "id")?,
            label: required_string(&value, "label")?,
            theme_id: required_string(&value, "theme")?,
            description: required_string(&value, "description")?,
            weight: value
                .get("weight")
                .and_then(toml::Value::as_float)
                .unwrap_or(0.0),
            scale: value
                .get("scale")
                .and_then(toml::Value::as_str)
                .unwrap_or("binary")
                .into(),
            positive_examples: string_array(&value, "positive_examples"),
            negative_examples: string_array(&value, "negative_examples"),
            anti_patterns: string_array(&value, "anti_patterns"),
            boundaries: value
                .get("boundaries")
                .and_then(toml::Value::as_str)
                .unwrap_or_default()
                .into(),
            edge_cases: string_array(&value, "edge_cases"),
            evidence_requirement: value
                .get("evidence_requirement")
                .and_then(toml::Value::as_str)
                .unwrap_or("none")
                .into(),
            tags: string_array(&value, "tags"),
            references: string_array(&value, "references"),
            sibling_links: string_array(&value, "sibling_links"),
            status: value
                .get("status")
                .and_then(toml::Value::as_str)
                .unwrap_or("Draft")
                .into(),
            comments: string_array(&value, "comments"),
        });
    }
    Ok(criteria)
}

fn read_samples(
    root: &Path,
    paths: Option<&toml::Value>,
) -> Result<Vec<SampleFile>, ProjectOpenFailure> {
    let samples_root = root.join(path_from_manifest(paths, "samples", "samples"));
    let mut samples = Vec::new();
    for file in sorted_files(&samples_root, "jsonl")? {
        let source = std::fs::read_to_string(&file).map_err(|error| {
            project_open_failure("samples", format!("Sample file could not be read: {error}"))
        })?;
        for (index, line) in source.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let sample = serde_json::from_str::<SampleFile>(line).map_err(|error| {
                project_open_failure(
                    "samples",
                    format!(
                        "{} line {} is invalid JSONL: {error}",
                        file.display(),
                        index + 1
                    ),
                )
            })?;
            samples.push(sample);
        }
    }
    Ok(samples)
}

fn read_judges(
    root: &Path,
    paths: Option<&toml::Value>,
) -> Result<Vec<JudgeFile>, ProjectOpenFailure> {
    let judges_root = root.join(path_from_manifest(paths, "judges", "judges"));
    let mut judges = Vec::new();
    for file in sorted_files(&judges_root, "toml")? {
        let source = std::fs::read_to_string(&file).map_err(|error| {
            project_open_failure("judges", format!("Judge file could not be read: {error}"))
        })?;
        let value = source.parse::<toml::Value>().map_err(|error| {
            project_open_failure("judges", format!("Judge file is invalid TOML: {error}"))
        })?;
        judges.push(JudgeFile {
            id: required_string(&value, "id")?,
            label: required_string(&value, "label")?,
            provider: required_string(&value, "provider")?,
            model: required_string(&value, "model")?,
            enabled: value
                .get("enabled")
                .and_then(toml::Value::as_bool)
                .unwrap_or(true),
            key_configured: false,
        });
    }
    Ok(judges)
}

fn sorted_files(root: &Path, extension: &str) -> Result<Vec<PathBuf>, ProjectOpenFailure> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_files(root, extension, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_files(
    root: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
) -> Result<(), ProjectOpenFailure> {
    for entry in std::fs::read_dir(root).map_err(|error| {
        project_open_failure(
            "path",
            format!("Project folder could not be listed: {error}"),
        )
    })? {
        let path = entry
            .map_err(|error| {
                project_open_failure(
                    "path",
                    format!("Project folder entry could not be read: {error}"),
                )
            })?
            .path();
        if path.is_dir() {
            collect_files(&path, extension, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some(extension) {
            files.push(path);
        }
    }
    Ok(())
}

fn required_string(value: &toml::Value, key: &str) -> Result<String, ProjectOpenFailure> {
    value
        .get(key)
        .and_then(toml::Value::as_str)
        .filter(|item| !item.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| project_open_failure(key, format!("{key} is required.")))
}

fn string_array(value: &toml::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(toml::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(toml::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn path_from_manifest(paths: Option<&toml::Value>, key: &str, default_path: &str) -> String {
    paths
        .and_then(|value| value.get(key))
        .and_then(toml::Value::as_str)
        .unwrap_or(default_path)
        .into()
}

fn slug_manifest_name(manifest: &toml::Value) -> &str {
    manifest
        .get("name")
        .and_then(toml::Value::as_str)
        .unwrap_or("untitled-rubric")
}

fn file_stem(file: &Path) -> String {
    file.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled")
        .to_string()
}

fn current_unix_timestamp_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn project_open_failure(
    field: impl Into<String>,
    message: impl Into<String>,
) -> ProjectOpenFailure {
    ProjectOpenFailure {
        field: field.into(),
        message: message.into(),
    }
}

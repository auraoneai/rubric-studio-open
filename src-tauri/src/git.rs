use git2::{
    build::CheckoutBuilder, BranchType, Cred, Direction, FetchOptions, IndexAddOption,
    MergeAnalysis, PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectGitResult {
    pub operation: String,
    pub branch: String,
    pub message: String,
    pub stdout: String,
    pub stderr: String,
    pub changed_files: usize,
    pub remote_configured: bool,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectGitFailure {
    pub operation: String,
    pub message: String,
}

pub fn git_status_summary(branch: &str, changed_files: usize) -> String {
    format!("{branch}: {changed_files} changed files, local-only")
}

pub fn run_project_git_operation(
    path: PathBuf,
    operation: String,
    target_branch: String,
    remote_url: String,
    commit_message: String,
) -> Result<ProjectGitResult, ProjectGitFailure> {
    let project_root = path.canonicalize().map_err(|error| ProjectGitFailure {
        operation: operation.clone(),
        message: format!("Project path is not readable: {error}"),
    })?;
    if !project_root.is_dir() || !project_root.join("rubric.toml").is_file() {
        return Err(ProjectGitFailure {
            operation,
            message: "Git operations require an opened Rubric Studio project folder.".into(),
        });
    }

    let normalized_branch = normalize_git_branch(&target_branch);
    let remote = remote_url.trim();
    let message = if commit_message.trim().is_empty() {
        "Update rubric project"
    } else {
        commit_message.trim()
    };

    let mut stdout = String::new();
    match operation.as_str() {
        "init" => {
            let repository = init_or_open_repository(&project_root)
                .map_err(|error| git_failure(&operation, error))?;
            if repository.is_empty().unwrap_or(false) {
                repository
                    .set_head("refs/heads/main")
                    .map_err(|error| git_failure(&operation, error))?;
            }
            stdout.push_str("Initialized libgit2 repository.");
        }
        "status" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(
                &status_text(&repository).map_err(|error| git_failure(&operation, error))?,
            );
        }
        "branch" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            create_branch(&repository, &normalized_branch)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(&format!("Created branch {normalized_branch}."));
        }
        "switch" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            switch_branch(&repository, &normalized_branch)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(&format!("Switched to {normalized_branch}."));
        }
        "remote-add" => {
            if remote.is_empty() || remote.chars().any(char::is_whitespace) {
                return Err(ProjectGitFailure {
                    operation,
                    message: "Enter a remote URL without whitespace before configuring origin."
                        .into(),
                });
            }
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            configure_origin(&repository, remote)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str("Configured origin.");
        }
        "fetch" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            fetch_origin(&repository, &normalized_branch)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(&format!("Fetched origin/{normalized_branch}."));
        }
        "pull" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            fetch_origin(&repository, &normalized_branch)
                .map_err(|error| git_failure(&operation, error))?;
            fast_forward(
                &repository,
                &format!("refs/remotes/origin/{normalized_branch}"),
            )
            .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(&format!(
                "Pulled origin/{normalized_branch} with fast-forward policy."
            ));
        }
        "push" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            push_current_branch(&repository).map_err(|error| git_failure(&operation, error))?;
            stdout.push_str("Pushed current branch to origin.");
        }
        "fast-forward-merge" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            fast_forward(&repository, &normalized_branch)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str(&format!("Fast-forward merged {normalized_branch}."));
        }
        "commit" => {
            let repository =
                open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
            commit_project_snapshot(&repository, message)
                .map_err(|error| git_failure(&operation, error))?;
            stdout.push_str("Committed current rubric snapshot.");
        }
        _ => {
            return Err(ProjectGitFailure {
                operation,
                message: "Unsupported Rubric Studio git operation.".into(),
            })
        }
    }

    let repository =
        init_or_open_repository(&project_root).map_err(|error| git_failure(&operation, error))?;
    let branch = current_git_branch(&repository).unwrap_or_else(|| normalized_branch.clone());
    let changed_files = git_changed_file_count(&repository);
    let remote_configured = git_remote_exists(&repository, "origin");
    Ok(ProjectGitResult {
        message: summarize_git_success(&operation, &branch, changed_files, remote_configured),
        operation,
        branch,
        stdout,
        stderr: String::new(),
        changed_files,
        remote_configured,
        success: true,
    })
}

fn init_or_open_repository(root: &Path) -> Result<Repository, git2::Error> {
    open_repository(root).or_else(|_| Repository::init(root))
}

fn open_repository(root: &Path) -> Result<Repository, git2::Error> {
    Repository::open(root)
}

fn status_text(repository: &Repository) -> Result<String, git2::Error> {
    let mut options = status_options();
    let statuses = repository.statuses(Some(&mut options))?;
    let mut lines = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("<unknown>");
        lines.push(format!("{:?} {path}", entry.status()));
    }
    Ok(lines.join("\n"))
}

fn create_branch(repository: &Repository, branch: &str) -> Result<(), git2::Error> {
    if repository.find_branch(branch, BranchType::Local).is_ok() {
        return Ok(());
    }
    let commit = head_commit(repository)?;
    repository.branch(branch, &commit, false)?;
    Ok(())
}

fn switch_branch(repository: &Repository, branch: &str) -> Result<(), git2::Error> {
    let reference_name = format!("refs/heads/{branch}");
    repository.find_reference(&reference_name)?;
    repository.set_head(&reference_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repository.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn configure_origin(repository: &Repository, remote: &str) -> Result<(), git2::Error> {
    if repository.find_remote("origin").is_ok() {
        repository.remote_set_url("origin", remote)?;
    } else {
        repository.remote("origin", remote)?;
    }
    Ok(())
}

fn fetch_origin(repository: &Repository, branch: &str) -> Result<(), git2::Error> {
    let mut remote = repository.find_remote("origin")?;
    let mut options = FetchOptions::new();
    options.remote_callbacks(remote_callbacks());
    remote.fetch(&[branch], Some(&mut options), None)?;
    Ok(())
}

fn push_current_branch(repository: &Repository) -> Result<(), git2::Error> {
    let branch = current_git_branch(repository)
        .ok_or_else(|| git2::Error::from_str("Current branch is unknown."))?;
    let mut remote = repository.find_remote("origin")?;
    let mut options = PushOptions::new();
    options.remote_callbacks(remote_callbacks());
    remote.connect(Direction::Push)?;
    remote.push(
        &[format!("refs/heads/{branch}:refs/heads/{branch}")],
        Some(&mut options),
    )?;
    Ok(())
}

fn fast_forward(repository: &Repository, revision: &str) -> Result<(), git2::Error> {
    let object = repository.revparse_single(revision)?;
    let commit = object.peel_to_commit()?;
    let annotated = repository.find_annotated_commit(commit.id())?;
    let (analysis, _) = repository.merge_analysis(&[&annotated])?;
    if !analysis.contains(MergeAnalysis::ANALYSIS_FASTFORWARD)
        && !analysis.contains(MergeAnalysis::ANALYSIS_UP_TO_DATE)
    {
        return Err(git2::Error::from_str(
            "Fast-forward merge is not possible; resolve conflicts outside the OSS app.",
        ));
    }
    if analysis.contains(MergeAnalysis::ANALYSIS_UP_TO_DATE) {
        return Ok(());
    }
    let head_name = repository
        .head()
        .ok()
        .and_then(|reference| reference.name().map(str::to_string))
        .ok_or_else(|| git2::Error::from_str("Current branch reference is unknown."))?;
    repository.reference(&head_name, commit.id(), true, "fast-forward")?;
    repository.set_head(&head_name)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repository.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn commit_project_snapshot(repository: &Repository, message: &str) -> Result<(), git2::Error> {
    let mut index = repository.index()?;
    index.add_all(project_pathspecs(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_oid = index.write_tree()?;
    let tree = repository.find_tree(tree_oid)?;
    let signature = repository
        .signature()
        .or_else(|_| Signature::now("Rubric Studio Open", "rubric-studio-open@auraone.ai"))?;
    if let Ok(parent) = head_commit(repository) {
        if parent.tree_id() == tree_oid {
            return Ok(());
        }
        repository.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[&parent],
        )?;
    } else {
        repository.commit(Some("HEAD"), &signature, &signature, message, &tree, &[])?;
    }
    Ok(())
}

fn project_pathspecs() -> [&'static str; 9] {
    [
        "rubric.toml",
        "themes",
        "criteria",
        "samples",
        "judges",
        "README.md",
        ".gitignore",
        ".rubric-comments.toml",
        ".rubric-comments.toml/**",
    ]
}

fn remote_callbacks() -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_url, username, allowed| {
        if allowed.is_ssh_key() {
            if let Some(username) = username {
                return Cred::ssh_key_from_agent(username);
            }
        }
        if allowed.is_default() {
            return Cred::default();
        }
        Cred::default()
    });
    callbacks
}

fn head_commit(repository: &Repository) -> Result<git2::Commit<'_>, git2::Error> {
    repository.head()?.peel_to_commit()
}

fn current_git_branch(repository: &Repository) -> Option<String> {
    repository
        .head()
        .ok()
        .and_then(|head| {
            head.shorthand().map(str::to_string).or_else(|| {
                head.name()
                    .and_then(|name| name.strip_prefix("refs/heads/").map(str::to_string))
            })
        })
        .filter(|branch| !branch.is_empty())
}

fn git_changed_file_count(repository: &Repository) -> usize {
    let mut options = status_options();
    repository
        .statuses(Some(&mut options))
        .map(|statuses| statuses.len())
        .unwrap_or(0)
}

fn status_options() -> StatusOptions {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    options
}

fn git_remote_exists(repository: &Repository, name: &str) -> bool {
    repository.find_remote(name).is_ok()
}

fn normalize_git_branch(value: &str) -> String {
    let branch = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_whitespace() {
                '-'
            } else {
                character
            }
        })
        .filter(|character| character.is_ascii_alphanumeric() || "/_-.".contains(*character))
        .collect::<String>()
        .trim_matches('/')
        .to_string();
    if branch.is_empty() {
        "main".into()
    } else {
        branch
    }
}

fn git_failure(operation: &str, error: git2::Error) -> ProjectGitFailure {
    ProjectGitFailure {
        operation: operation.into(),
        message: summarize_git_failure(error.message()),
    }
}

fn summarize_git_failure(detail: &str) -> String {
    if detail.trim().is_empty() {
        "Git operation failed.".into()
    } else {
        detail
            .lines()
            .next()
            .unwrap_or("Git operation failed.")
            .into()
    }
}

fn summarize_git_success(
    operation: &str,
    branch: &str,
    changed_files: usize,
    remote_configured: bool,
) -> String {
    match operation {
        "init" => format!("Initialized git repository on {branch}."),
        "status" => format!(
            "{branch}: {changed_files} changed file{}.",
            if changed_files == 1 { "" } else { "s" }
        ),
        "branch" => "Created local branch.".into(),
        "switch" => format!("Switched to {branch}."),
        "remote-add" => "Configured origin remote.".into(),
        "fetch" => "Fetched refs from origin.".into(),
        "pull" => "Pulled with fast-forward-only policy.".into(),
        "push" => {
            if remote_configured {
                format!("Pushed {branch} to origin.")
            } else {
                "Push completed without an origin remote.".into()
            }
        }
        "fast-forward-merge" => "Fast-forward merge completed.".into(),
        "commit" => format!("Committed current rubric snapshot on {branch}."),
        _ => "Git operation completed.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::create_rubric_project_from_template;

    #[test]
    fn project_git_operations_run_inside_opened_project_folder_with_libgit2() {
        let parent = std::env::temp_dir().join(format!(
            "rubric-studio-open-git-test-{}",
            std::process::id(),
        ));
        if parent.exists() {
            std::fs::remove_dir_all(&parent).unwrap();
        }
        std::fs::create_dir_all(&parent).unwrap();
        let opened =
            create_rubric_project_from_template(parent.clone(), "Git Rubric".into()).unwrap();
        let project_path = PathBuf::from(opened.path);

        let init = run_project_git_operation(
            project_path.clone(),
            "init".into(),
            "main".into(),
            "".into(),
            "".into(),
        )
        .unwrap();
        assert!(init.success);

        let repository = Repository::open(&project_path).unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.email", "tests@auraone.ai")
            .unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.name", "Rubric Tests")
            .unwrap();

        let commit = run_project_git_operation(
            project_path.clone(),
            "commit".into(),
            "main".into(),
            "".into(),
            "Initial rubric commit".into(),
        )
        .unwrap();
        assert!(commit.success);
        assert_eq!(commit.changed_files, 0);
        assert!(repository.find_reference("refs/heads/main").is_ok());

        let branch = run_project_git_operation(
            project_path.clone(),
            "branch".into(),
            "review/git-ops".into(),
            "".into(),
            "".into(),
        )
        .unwrap();
        assert!(branch.success);

        let switched = run_project_git_operation(
            project_path.clone(),
            "switch".into(),
            "review/git-ops".into(),
            "".into(),
            "".into(),
        )
        .unwrap();
        assert_eq!(switched.branch, "review/git-ops");

        let status = run_project_git_operation(
            project_path,
            "status".into(),
            "review/git-ops".into(),
            "".into(),
            "".into(),
        )
        .unwrap();
        assert!(status.message.contains("review/git-ops"));

        std::fs::remove_dir_all(parent).unwrap();
    }
}

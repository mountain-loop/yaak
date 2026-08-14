use crate::cli::{AgentArgs, AgentCommands};
use crate::ui;
use crate::version;
use include_dir::{Dir, include_dir};
use std::fs;
use std::path::{Path, PathBuf};

static SKILL_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/skills/use-yaak");

const SKILL_NAME: &str = "use-yaak";

/// Substituted at install time so the installed skill records which CLI wrote it,
/// letting `--help` tell the user when an upgrade has left their copy behind.
const VERSION_PLACEHOLDER: &str = "__YAAK_CLI_VERSION__";
const VERSION_MARKER: &str = "yaak-cli-version:";

type CommandResult<T = ()> = std::result::Result<T, String>;

/// A coding tool that reads skills from a directory in the user's home.
struct Target {
    /// Display name used in output.
    label: &'static str,
    /// Directory holding all skills for this tool (`…/skills`).
    skills_dir: PathBuf,
}

pub fn run(args: AgentArgs) -> i32 {
    let result = match args.command {
        AgentCommands::Install { agent } => install(agent),
        AgentCommands::Remove { agent } => remove(agent),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

fn install(agent: Option<Vec<String>>) -> CommandResult {
    let targets = resolve_targets(agent)?;

    let mut installed = 0usize;
    for target in &targets {
        let dir = target.skills_dir.join(SKILL_NAME);
        match write_skill(&dir) {
            Ok(()) => {
                installed += 1;
                ui::success(&format!("{} -> {}", target.label, dir.display()));
            }
            Err(error) => ui::warning_stderr(&format!("{}: {}", target.label, error)),
        }
    }

    if installed == 0 {
        return Err("Failed to install the Yaak skill anywhere".to_string());
    }

    ui::info("Restart your coding tool to pick up the skill");
    Ok(())
}

fn remove(agent: Option<Vec<String>>) -> CommandResult {
    let targets = resolve_targets(agent)?;

    let mut removed = 0usize;
    for target in &targets {
        let dir = target.skills_dir.join(SKILL_NAME);
        if !dir.exists() {
            continue;
        }
        match fs::remove_dir_all(&dir) {
            Ok(()) => {
                removed += 1;
                ui::success(&format!("Removed {}", dir.display()));
            }
            Err(error) => {
                ui::warning_stderr(&format!("Failed to remove {}: {error}", dir.display()))
            }
        }
    }

    if removed == 0 {
        ui::info("No Yaak skill was installed");
    }
    Ok(())
}

/// The skill directory belongs to the CLI, so every install overwrites what is there
/// and prunes what this version no longer ships. Preserving local edits would be worse
/// than losing them: an edited file would be skipped by every future install and go
/// stale forever, against a CLI that keeps changing.
///
/// NOTE: atomicity is per file, not for the install as a whole. That is total today
/// because the skill is a single file, but adding a second one would mean a reader
/// could catch a mix of old and new files. Replacing the directory as a unit is not an
/// option (`rename` refuses a non-empty destination), so a multi-file skill would need
/// the published path to become a symlink swapped between versioned directories.
fn write_skill(dir: &Path) -> CommandResult {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;

    let mut written = Vec::new();
    for file in walk(&SKILL_DIR) {
        let relative = file.path().to_path_buf();
        let destination = dir.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }

        let contents = stamp_version(file.contents());
        write_atomic(&destination, &contents)?;
        written.push(relative);
    }

    prune_unshipped(dir, &written);
    Ok(())
}

/// Write via a sibling temp file and rename over the destination. `rename` replaces an
/// existing file atomically, so a reader sees either the old copy or the new one, and a
/// crash part way through cannot leave a half-written skill behind.
fn write_atomic(destination: &Path, contents: &[u8]) -> CommandResult {
    let parent = destination
        .parent()
        .ok_or_else(|| format!("Invalid skill path {}", destination.display()))?;
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid skill path {}", destination.display()))?;
    let temp = parent.join(format!(".{name}.tmp-{}", std::process::id()));

    fs::write(&temp, contents)
        .map_err(|e| format!("Failed to write {}: {e}", destination.display()))?;

    match fs::rename(&temp, destination) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(format!("Failed to write {}: {error}", destination.display()))
        }
    }
}

/// Stamp the running version into the skill so it carries its own provenance.
fn stamp_version(contents: &[u8]) -> Vec<u8> {
    match std::str::from_utf8(contents) {
        Ok(text) => text.replace(VERSION_PLACEHOLDER, version::cli_version()).into_bytes(),
        Err(_) => contents.to_vec(),
    }
}

/// Drop anything this version does not ship, so files an older version wrote (or a
/// leftover temp file) cannot linger beside the refreshed skill.
fn prune_unshipped(dir: &Path, written: &[PathBuf]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(relative) = path.strip_prefix(dir) else {
            continue;
        };
        if written.iter().any(|w| w == relative || w.starts_with(relative)) {
            continue;
        }
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Read the version an installed skill was stamped with.
fn installed_version(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("SKILL.md")).ok()?;
    text.lines()
        .find_map(|line| line.trim().strip_prefix(VERSION_MARKER))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && v != VERSION_PLACEHOLDER)
}

/// Health summary appended to root `--help`, so an agent can notice in one command
/// that an upgraded CLI has left the installed skill behind. Silent when nothing is
/// installed anywhere, to avoid nagging users who do not use agent tooling.
pub fn help_section() -> Option<String> {
    let targets = resolve_targets(None).ok()?;
    let current = version::cli_version();

    let mut stale = Vec::new();
    let mut installed = 0usize;
    for target in &targets {
        let dir = target.skills_dir.join(SKILL_NAME);
        if !dir.join("SKILL.md").exists() {
            continue;
        }
        installed += 1;

        let found = installed_version(&dir).unwrap_or_default();
        if found != current {
            let found = if found.is_empty() { "unknown".to_string() } else { found };
            stale.push(format!("{} ({found})", target.label));
        }
    }

    if installed == 0 {
        return None;
    }

    if stale.is_empty() {
        return Some(format!(
            "Agent tooling:\n  Yaak skill is installed and up to date ({current})"
        ));
    }

    Some(format!(
        "Agent tooling:\n  Yaak skill is out of date for {} — CLI is {current}\n  Run `yaak agent install`, then restart your coding tool",
        stale.join(", ")
    ))
}

/// Flatten the embedded skill directory into its files, recursing into subdirectories.
fn walk<'a>(dir: &'a Dir<'a>) -> Vec<&'a include_dir::File<'a>> {
    let mut files: Vec<_> = dir.files().collect();
    for child in dir.dirs() {
        files.extend(walk(child));
    }
    files
}

/// `~/.agents/skills` is the cross-tool location and is always written. Tool-specific
/// directories are written only when that tool is already set up on this machine, so
/// installing never creates a config directory for a tool the user does not use.
fn resolve_targets(requested: Option<Vec<String>>) -> CommandResult<Vec<Target>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;

    let known: Vec<(&str, PathBuf, PathBuf)> = vec![
        ("agents", home.join(".agents"), home.join(".agents").join("skills")),
        ("claude-code", home.join(".claude"), home.join(".claude").join("skills")),
        ("cursor", home.join(".cursor"), home.join(".cursor").join("skills")),
        ("codex", home.join(".codex"), home.join(".codex").join("skills")),
        ("opencode", home.join(".opencode"), home.join(".opencode").join("skills")),
    ];

    if let Some(requested) = requested {
        let mut targets = Vec::new();
        for name in requested {
            let found =
                known.iter().find(|(label, _, _)| *label == name.as_str()).ok_or_else(|| {
                    let names: Vec<_> = known.iter().map(|(l, _, _)| *l).collect();
                    format!("Unknown agent '{name}'. Known agents: {}", names.join(", "))
                })?;
            targets.push(Target { label: found.0, skills_dir: found.2.clone() });
        }
        return Ok(targets);
    }

    let targets: Vec<Target> = known
        .into_iter()
        .filter(|(label, marker, _)| *label == "agents" || marker.exists())
        .map(|(label, _, skills_dir)| Target { label, skills_dir })
        .collect();

    Ok(targets)
}

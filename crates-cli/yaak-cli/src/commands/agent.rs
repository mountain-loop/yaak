use crate::cli::{AgentArgs, AgentCommands};
use crate::ui;
use crate::version;
use include_dir::{Dir, include_dir};
use std::fs;
use std::path::{Path, PathBuf};

static SKILL_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/skills/use-yaak");

const SKILL_NAME: &str = "use-yaak";

/// Records which CLI version wrote the skill, so `--help` can tell the user when an
/// upgrade has left their installed copy behind.
const VERSION_FILE: &str = ".yaak-version";

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

/// The skill directory belongs to the CLI, so every install replaces it wholesale.
/// That keeps it exactly in step with the installed version, including dropping files
/// an older version shipped. Preserving local edits would be worse than losing them:
/// an edited file would be skipped by every future install and go stale forever,
/// against a CLI that keeps changing.
fn write_skill(dir: &Path) -> CommandResult {
    let parent =
        dir.parent().ok_or_else(|| format!("Invalid skill path {}", dir.display()))?.to_path_buf();
    fs::create_dir_all(&parent)
        .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;

    // Move the working copy aside before writing, so a failure part way through can
    // put it back instead of leaving nothing behind. The destination has to be vacated
    // either way: `rename` cannot replace a non-empty directory.
    let previous = parent.join(format!(".{SKILL_NAME}.old-{}", std::process::id()));
    let _ = fs::remove_dir_all(&previous);

    let had_previous = dir.exists();
    if had_previous {
        fs::rename(dir, &previous)
            .map_err(|e| format!("Failed to replace {}: {e}", dir.display()))?;
    }

    match write_files(dir) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&previous);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_dir_all(dir);
            if had_previous {
                let _ = fs::rename(&previous, dir);
            }
            Err(error)
        }
    }
}

fn write_files(dir: &Path) -> CommandResult {
    for file in walk(&SKILL_DIR) {
        let destination = dir.join(file.path());
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        fs::write(&destination, file.contents())
            .map_err(|e| format!("Failed to write {}: {e}", destination.display()))?;
    }

    fs::write(dir.join(VERSION_FILE), version::cli_version())
        .map_err(|e| format!("Failed to write skill version: {e}"))
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

        let found = fs::read_to_string(dir.join(VERSION_FILE))
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
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

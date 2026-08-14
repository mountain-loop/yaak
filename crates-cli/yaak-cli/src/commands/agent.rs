use crate::cli::{AgentArgs, AgentCommands};
use crate::ui;
use include_dir::{Dir, include_dir};
use std::fs;
use std::path::{Path, PathBuf};

static SKILL_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/skills/use-yaak");

const SKILL_NAME: &str = "use-yaak";

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
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("Failed to replace {}: {e}", dir.display()))?;
    }

    for file in walk(&SKILL_DIR) {
        let destination = dir.join(file.path());
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        fs::write(&destination, file.contents())
            .map_err(|e| format!("Failed to write {}: {e}", destination.display()))?;
    }

    Ok(())
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
